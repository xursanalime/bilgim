import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import { LiveSessionJoin } from './live-session-join';
import { liveApi } from '../../lib/api/live';
import { getUserRole, getCurrentUser } from '../../lib/auth';

/**
 * Tests for the Live_Viewer gating wrapper (task 3.2, Req 7.3).
 *
 * Focus:
 *  - APPROVED-only gating: a 403 from the BFF `join` (LessonAccessGuard) shows
 *    a clear "not approved / not enrolled" state.
 *  - A 404 shows the "not started yet" waiting state.
 *  - A successful STUDENT join routes to the light Live_Viewer and passes a
 *    server-derived (or safely-masked fallback) forensic watermark label.
 *  - A successful TEACHER join routes to the host studio (Live_Studio).
 */

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

// Resolve next/dynamic synchronously via React.lazy so we can assert routing
// without pulling in the LiveKit-heavy bundles.
jest.mock('next/dynamic', () => {
  const ReactLib = require('react');
  return (loader: () => Promise<unknown>) => {
    const Lazy = ReactLib.lazy(() =>
      loader().then((C: unknown) => ({ default: C })),
    );
    const Dyn = (props: Record<string, unknown>) =>
      ReactLib.createElement(
        ReactLib.Suspense,
        { fallback: null },
        ReactLib.createElement(Lazy, props),
      );
    return Dyn;
  };
});

jest.mock('../live-room/LiveViewer', () => ({
  LiveViewer: (props: { watermarkLabel: string }) => (
    <div data-testid="live-viewer">{props.watermarkLabel}</div>
  ),
}));

jest.mock('../live-room/LiveRoom', () => ({
  LiveRoom: (props: { role: string }) => (
    <div data-testid="live-room">{props.role}</div>
  ),
}));

jest.mock('../../lib/api/live', () => ({
  liveApi: { join: jest.fn(), start: jest.fn() },
}));

jest.mock('../../lib/auth', () => ({
  getUserRole: jest.fn(),
  getCurrentUser: jest.fn(),
}));

const mockedJoin = liveApi.join as jest.Mock;
const mockedGetRole = getUserRole as jest.Mock;
const mockedGetUser = getCurrentUser as jest.Mock;

const SESSION = {
  id: 'sess1234-aaaa-bbbb',
  lessonId: 'lesson-1',
  status: 'LIVE',
  roomId: 'room-1',
  startedAt: null,
  endedAt: null,
};
const SFU = { lessonId: 'lesson-1', roomId: 'room-1', participantCount: 1 };

describe('LiveSessionJoin — APPROVED-only gating & routing (Req 7.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRole.mockReturnValue('STUDENT');
    mockedGetUser.mockReturnValue({ email: 'john@mail.com' });
  });

  it('shows a clear "not approved / not enrolled" state on 403', async () => {
    mockedJoin.mockRejectedValue({ statusCode: 403, message: 'Forbidden' });

    render(<LiveSessionJoin locale="uz" lessonId="lesson-1" />);

    expect(await screen.findByText('Bu darsga kira olmaysiz')).toBeInTheDocument();
    expect(screen.getByText(/tasdiqlangan \(APPROVED\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId('live-viewer')).not.toBeInTheDocument();
  });

  it('shows the "not started yet" waiting state on 404', async () => {
    mockedJoin.mockRejectedValue({ statusCode: 404, message: 'Not found' });

    render(<LiveSessionJoin locale="uz" lessonId="lesson-1" />);

    expect(await screen.findByText('Efir hali boshlanmagan')).toBeInTheDocument();
  });

  it('routes a STUDENT to the light Live_Viewer with a masked watermark fallback', async () => {
    mockedJoin.mockResolvedValue({
      session: SESSION,
      sfu: SFU,
      token: 'tok',
      role: 'STUDENT',
      // No server watermark → component derives a PII-masked fallback.
    });

    render(<LiveSessionJoin locale="uz" lessonId="lesson-1" />);

    const viewer = await screen.findByTestId('live-viewer');
    // maskEmail('john@mail.com') = 'j•••@mail.com'; session id sliced to 'sess'.
    expect(viewer).toHaveTextContent('j•••@mail.com • sess');
  });

  it('prefers the server-derived watermark label when present', async () => {
    mockedJoin.mockResolvedValue({
      session: SESSION,
      sfu: SFU,
      token: 'tok',
      role: 'STUDENT',
      watermark: { label: 'server-label • zzzz' },
    });

    render(<LiveSessionJoin locale="uz" lessonId="lesson-1" />);

    const viewer = await screen.findByTestId('live-viewer');
    expect(viewer).toHaveTextContent('server-label • zzzz');
  });

  it('routes a TEACHER to the host studio (Live_Studio), not the viewer', async () => {
    mockedGetRole.mockReturnValue('TEACHER');
    mockedJoin.mockResolvedValue({
      session: SESSION,
      sfu: SFU,
      token: 'tok',
      role: 'TEACHER',
    });

    render(<LiveSessionJoin locale="uz" lessonId="lesson-1" />);

    const studio = await screen.findByTestId('live-room');
    expect(studio).toHaveTextContent('TEACHER');
    expect(screen.queryByTestId('live-viewer')).not.toBeInTheDocument();
  });
});
