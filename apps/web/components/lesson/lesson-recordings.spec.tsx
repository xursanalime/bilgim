import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LessonRecordings } from './lesson-recordings';
import { liveApi, type LessonRecording } from '../../lib/api/live';

jest.mock('../../lib/api/live', () => ({
  liveApi: { listRecordings: jest.fn() },
}));

// The real ProtectedVideoPlayer pulls in Shaka/EME + the protected-media hook.
// We only need to assert it is rendered with the right asset/lesson, so stub it.
jest.mock('../media/protected-video-player', () => ({
  ProtectedVideoPlayer: ({
    assetId,
    lessonId,
  }: {
    assetId: string;
    lessonId: string;
  }) => (
    <div data-testid="protected-player" data-asset={assetId} data-lesson={lessonId} />
  ),
}));

const listRecordings = liveApi.listRecordings as jest.Mock;

function recording(
  overrides: Partial<LessonRecording> & { id: string },
): LessonRecording {
  return {
    lessonId: 'lesson-1',
    sessionId: 'session-1',
    assetId: null,
    durationMs: null,
    status: 'READY',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderRecordings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LessonRecordings lessonId="lesson-1" />
    </QueryClientProvider>,
  );
}

describe('LessonRecordings', () => {
  beforeEach(() => {
    listRecordings.mockReset();
  });

  it('renders nothing when the lesson has no recordings', async () => {
    listRecordings.mockResolvedValue([]);

    const { container } = renderRecordings();

    await waitFor(() => expect(listRecordings).toHaveBeenCalledWith('lesson-1'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lazily plays a READY recording through the protected player on demand', async () => {
    const user = userEvent.setup();
    listRecordings.mockResolvedValue([
      recording({
        id: 'rec-1',
        assetId: 'asset-1',
        status: 'READY',
        durationMs: 65000,
      }),
    ]);

    renderRecordings();

    // The player is NOT mounted until the student presses play (no premature
    // playback-ticket mint).
    const playButton = await screen.findByRole('button', {
      name: /ko'rish/i,
    });
    expect(screen.queryByTestId('protected-player')).toBeNull();

    await user.click(playButton);

    const player = await screen.findByTestId('protected-player');
    expect(player).toHaveAttribute('data-asset', 'asset-1');
    expect(player).toHaveAttribute('data-lesson', 'lesson-1');
  });

  it('surfaces a FAILED finalize gracefully without a player', async () => {
    listRecordings.mockResolvedValue([
      recording({ id: 'rec-1', assetId: null, status: 'FAILED' }),
    ]);

    renderRecordings();

    expect(
      await screen.findByText(/yozuvini tayyorlab bo'lmadi/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('protected-player')).toBeNull();
    expect(screen.queryByRole('button', { name: /ko'rish/i })).toBeNull();
  });

  it('shows a finalizing notice for an in-progress RECORDING', async () => {
    listRecordings.mockResolvedValue([
      recording({ id: 'rec-1', assetId: null, status: 'RECORDING' }),
    ]);

    renderRecordings();

    expect(
      await screen.findByText(/yozuv tayyorlanmoqda/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('protected-player')).toBeNull();
  });

  it('surfaces a retryable error when the recordings request fails', async () => {
    listRecordings.mockRejectedValue(new Error('boom'));

    renderRecordings();

    expect(
      await screen.findByText(/yozuvlarni yuklab bo'lmadi/i),
    ).toBeInTheDocument();
  });
});
