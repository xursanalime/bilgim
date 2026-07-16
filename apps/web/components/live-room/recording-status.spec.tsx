import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { ConnectionState } from 'livekit-client';

import {
  ReconnectStatus,
  RecordingFinalizationNotice,
} from './recording-status';
import { liveApi, type LessonRecording } from '../../lib/api/live';

/**
 * Tests for the shared live-room status surfaces (task 3.3, Req 7.4/7.5/7.6):
 *  - ReconnectStatus: resilient reconnect banner, disconnected overlay, and a
 *    transient "reconnected" confirmation.
 *  - RecordingFinalizationNotice: finalization "processing", "ready" (with a
 *    deep link), and RECORDING_FAILED messaging with role-appropriate guidance.
 */

// Controllable LiveKit connection state.
let mockConnState: ConnectionState = ConnectionState.Connected;
jest.mock('@livekit/components-react', () => ({
  useConnectionState: () => mockConnState,
}));

// Mock the enum only — importing the real bundle pulls in browser globals
// (TextEncoder) that jsdom does not provide.
jest.mock('livekit-client', () => ({
  ConnectionState: {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
    SignalReconnecting: 'signalReconnecting',
  },
}));

jest.mock('../../lib/api/live', () => ({
  liveApi: { listRecordings: jest.fn() },
}));

// next/link → plain anchor so we can assert the recording deep link.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const listRecordings = liveApi.listRecordings as jest.Mock;

function recording(overrides: Partial<LessonRecording> & { id: string }): LessonRecording {
  return {
    lessonId: 'lesson-1',
    sessionId: 'sess-1',
    assetId: null,
    durationMs: null,
    status: 'RECORDING',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReconnectStatus (Req 7.6)', () => {
  beforeEach(() => {
    mockConnState = ConnectionState.Connected;
  });

  it('renders nothing while connected', () => {
    const { container } = render(<ReconnectStatus theme="dark" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a non-blocking reconnecting banner on a brief drop', () => {
    mockConnState = ConnectionState.Reconnecting;
    render(<ReconnectStatus theme="light" />);
    expect(screen.getByText('Qayta ulanmoqda…')).toBeInTheDocument();
  });

  it('shows a blocking disconnected overlay when the connection is lost', () => {
    mockConnState = ConnectionState.Disconnected;
    render(<ReconnectStatus theme="dark" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Aloqa uzildi')).toBeInTheDocument();
  });

  it('confirms recovery with a transient "reconnected" banner', () => {
    mockConnState = ConnectionState.Reconnecting;
    const { rerender } = render(<ReconnectStatus theme="light" />);
    expect(screen.getByText('Qayta ulanmoqda…')).toBeInTheDocument();

    mockConnState = ConnectionState.Connected;
    rerender(<ReconnectStatus theme="light" />);
    expect(screen.getByText('Aloqa tiklandi')).toBeInTheDocument();
  });
});

describe('RecordingFinalizationNotice (Req 7.4 / 7.5)', () => {
  beforeEach(() => {
    listRecordings.mockReset();
  });

  it('renders nothing while the session is still LIVE', () => {
    const { container } = render(
      <RecordingFinalizationNotice
        lessonId="lesson-1"
        status="LIVE"
        role="TEACHER"
        theme="dark"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(listRecordings).not.toHaveBeenCalled();
  });

  it('gives the instructor honest guidance on RECORDING_FAILED', async () => {
    listRecordings.mockResolvedValue([recording({ id: 'r1', status: 'FAILED' })]);
    render(
      <RecordingFinalizationNotice
        lessonId="lesson-1"
        status="RECORDING_FAILED"
        role="TEACHER"
        theme="dark"
      />,
    );
    expect(await screen.findByText('Yozib olish amalga oshmadi')).toBeInTheDocument();
    expect(screen.getByText(/qaytadan boshlashingiz mumkin/i)).toBeInTheDocument();
  });

  it('tells the learner the recording may be unavailable on RECORDING_FAILED', async () => {
    listRecordings.mockResolvedValue([recording({ id: 'r1', status: 'FAILED' })]);
    render(
      <RecordingFinalizationNotice
        lessonId="lesson-1"
        status="RECORDING_FAILED"
        role="STUDENT"
        theme="light"
      />,
    );
    expect(await screen.findByText('Yozib olish amalga oshmadi')).toBeInTheDocument();
    expect(screen.getByText(/o\u2018qituvchingizga murojaat qiling/i)).toBeInTheDocument();
  });

  it('reflects "processing" after the session ENDs and finalize is in flight', async () => {
    listRecordings.mockResolvedValue([recording({ id: 'r1', status: 'RECORDING' })]);
    render(
      <RecordingFinalizationNotice
        lessonId="lesson-1"
        status="ENDED"
        role="STUDENT"
        theme="light"
      />,
    );
    await waitFor(() => expect(listRecordings).toHaveBeenCalledWith('lesson-1'));
    expect(await screen.findByText('Yozuv tayyorlanmoqda')).toBeInTheDocument();
  });

  it('surfaces a ready recording with a deep link once finalized', async () => {
    listRecordings.mockResolvedValue([
      recording({ id: 'r1', status: 'READY', assetId: 'asset-1' }),
    ]);
    render(
      <RecordingFinalizationNotice
        lessonId="lesson-1"
        status="ENDED"
        role="STUDENT"
        theme="light"
        locale="uz"
      />,
    );
    expect(await screen.findByText('Yozuv tayyor')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Yozuvni ochish/i });
    expect(link).toHaveAttribute('href', '/uz/lessons/lesson-1');
  });
});
