import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LessonPlayer } from './lesson-player';
import {
  studentApi,
  type LessonAttachment,
  type LessonDetail,
  type StudentGroup,
} from '../../lib/api/student';
import { lessonProgressApi } from '../../lib/lesson-api';
import { getUserRole } from '../../lib/auth';

jest.mock('../../lib/api/student', () => ({
  studentApi: { getLesson: jest.fn(), getGroup: jest.fn() },
}));

jest.mock('../../lib/lesson-api', () => ({
  lessonProgressApi: {
    listGroupProgress: jest.fn(),
    markLessonComplete: jest.fn(),
  },
}));

jest.mock('../../lib/auth', () => ({ getUserRole: jest.fn() }));

// Stub heavy media + sibling surfaces; we only assert attachment gating.
jest.mock('../media/protected-video-player', () => ({
  ProtectedVideoPlayer: () => <div data-testid="protected-player" />,
}));

jest.mock('../media/protected-file-viewer', () => ({
  ProtectedFileViewer: ({ downloadAllowed }: { downloadAllowed: boolean }) => (
    <div
      data-testid="protected-file-viewer"
      data-download-allowed={downloadAllowed ? 'true' : 'false'}
    />
  ),
}));

jest.mock('./lesson-nav', () => ({ LessonNav: () => <div /> }));
jest.mock('./lesson-recordings', () => ({ LessonRecordings: () => <div /> }));

const getLesson = studentApi.getLesson as jest.Mock;
const getGroup = studentApi.getGroup as jest.Mock;
const listGroupProgress = lessonProgressApi.listGroupProgress as jest.Mock;
const mockRole = getUserRole as jest.Mock;

function attachment(
  overrides: Partial<LessonAttachment> & { id: string },
): LessonAttachment {
  return {
    lessonId: 'lesson-1',
    assetId: `asset-${overrides.id}`,
    kind: 'PDF',
    role: 'Material',
    position: 0,
    caption: null,
    ...overrides,
  };
}

function lesson(attachments: LessonAttachment[]): LessonDetail {
  return {
    id: 'lesson-1',
    groupId: 'group-1',
    title: 'Test lesson',
    description: null,
    type: 'VIDEO',
    status: 'READY',
    position: 0,
    scheduledAt: null,
    publishedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    attachments,
  };
}

function group(downloadAllowed: boolean | undefined): StudentGroup {
  return {
    id: 'group-1',
    courseId: 'course-1',
    name: 'Group 1',
    priceUzs: 0,
    capacity: null,
    startsOn: null,
    endsOn: null,
    status: 'ACTIVE',
    ...(downloadAllowed === undefined ? {} : { downloadAllowed }),
  };
}

function renderPlayer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LessonPlayer locale="uz" lessonId="lesson-1" />
    </QueryClientProvider>,
  );
}

describe('LessonPlayer attachment download gating (Req 2.2/6.5)', () => {
  beforeEach(() => {
    getLesson.mockReset();
    getGroup.mockReset();
    listGroupProgress.mockReset();
    mockRole.mockReset();
    listGroupProgress.mockResolvedValue([]);
    mockRole.mockReturnValue('STUDENT');
  });

  it('reveals download when the group allows it (group gate ∧ unrestricted)', async () => {
    getLesson.mockResolvedValue(lesson([attachment({ id: 'a1' })]));
    getGroup.mockResolvedValue(group(true));

    const user = userEvent.setup();
    renderPlayer();

    const open = await screen.findByRole('button', { name: /material/i });
    await waitFor(() => expect(getGroup).toHaveBeenCalledWith('group-1'));
    await user.click(open);

    const viewer = await screen.findByTestId('protected-file-viewer');
    expect(viewer).toHaveAttribute('data-download-allowed', 'true');
  });

  it('gates download closed when the group disallows downloads', async () => {
    getLesson.mockResolvedValue(lesson([attachment({ id: 'a1' })]));
    getGroup.mockResolvedValue(group(false));

    const user = userEvent.setup();
    renderPlayer();

    const open = await screen.findByRole('button', { name: /material/i });
    await waitFor(() => expect(getGroup).toHaveBeenCalledWith('group-1'));
    await user.click(open);

    const viewer = await screen.findByTestId('protected-file-viewer');
    expect(viewer).toHaveAttribute('data-download-allowed', 'false');
  });

  it('fails closed when the group omits downloadAllowed', async () => {
    getLesson.mockResolvedValue(lesson([attachment({ id: 'a1' })]));
    getGroup.mockResolvedValue(group(undefined));

    const user = userEvent.setup();
    renderPlayer();

    const open = await screen.findByRole('button', { name: /material/i });
    await waitFor(() => expect(getGroup).toHaveBeenCalledWith('group-1'));
    await user.click(open);

    const viewer = await screen.findByTestId('protected-file-viewer');
    expect(viewer).toHaveAttribute('data-download-allowed', 'false');
  });

  it('most-restrictive wins: per-attachment restrict overrides an allowing group', async () => {
    getLesson.mockResolvedValue(
      lesson([attachment({ id: 'a1', caption: 'restrict' })]),
    );
    getGroup.mockResolvedValue(group(true));

    const user = userEvent.setup();
    renderPlayer();

    const open = await screen.findByRole('button', { name: /material/i });
    await waitFor(() => expect(getGroup).toHaveBeenCalledWith('group-1'));
    await user.click(open);

    const viewer = await screen.findByTestId('protected-file-viewer');
    expect(viewer).toHaveAttribute('data-download-allowed', 'false');
  });

  it('leaves non-student previewers (teacher) ungated by the student gate', async () => {
    mockRole.mockReturnValue('TEACHER');
    getLesson.mockResolvedValue(lesson([attachment({ id: 'a1' })]));
    getGroup.mockResolvedValue(group(false));

    const user = userEvent.setup();
    renderPlayer();

    const open = await screen.findByRole('button', { name: /material/i });
    await user.click(open);

    const viewer = await screen.findByTestId('protected-file-viewer');
    expect(viewer).toHaveAttribute('data-download-allowed', 'true');
  });
});
