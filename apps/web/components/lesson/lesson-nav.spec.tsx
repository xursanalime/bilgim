import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LessonNav } from './lesson-nav';
import { studentApi, type LessonSummary } from '../../lib/api/student';
import { lessonProgressApi } from '../../lib/lesson-api';

jest.mock('../../lib/api/student', () => ({
  studentApi: { listLessons: jest.fn() },
}));
jest.mock('../../lib/lesson-api', () => ({
  lessonProgressApi: { listGroupProgress: jest.fn() },
}));

const listLessons = studentApi.listLessons as jest.Mock;
const listGroupProgress = lessonProgressApi.listGroupProgress as jest.Mock;

function lesson(overrides: Partial<LessonSummary> & { id: string }): LessonSummary {
  return {
    groupId: 'g1',
    title: overrides.id,
    description: null,
    type: 'VIDEO',
    status: 'READY',
    position: 0,
    scheduledAt: null,
    publishedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderNav() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LessonNav locale="en" groupId="g1" currentLessonId="l2" />
    </QueryClientProvider>,
  );
}

describe('LessonNav', () => {
  beforeEach(() => {
    listLessons.mockReset();
    listGroupProgress.mockReset();
  });

  it('renders the ordered lesson list with completion, current, and lock state', async () => {
    listLessons.mockResolvedValue([
      lesson({ id: 'l3', title: 'Lesson Three', position: 2, status: 'DRAFT' }),
      lesson({ id: 'l1', title: 'Lesson One', position: 0 }),
      lesson({ id: 'l2', title: 'Lesson Two', position: 1 }),
    ]);
    listGroupProgress.mockResolvedValue([
      { lessonId: 'l1', completed: true, completedAt: '2024-02-01T00:00:00.000Z' },
    ]);

    renderNav();

    // Completed lesson surfaces its badge.
    expect(await screen.findByText('Bajarildi')).toBeInTheDocument();

    // Completed/unlocked lesson is a real navigable link.
    const l1 = screen.getByText('1. Lesson One').closest('a');
    expect(l1).toHaveAttribute('href', '/en/lessons/l1');

    // Current lesson is marked aria-current and not duplicated as completed.
    const l2 = screen.getByText('2. Lesson Two').closest('a');
    expect(l2).toHaveAttribute('aria-current', 'page');

    // Locked (DRAFT) lesson is NOT clickable and shows the lock badge.
    expect(screen.getByText('Qulflangan')).toBeInTheDocument();
    expect(screen.getByText('3. Lesson Three').closest('a')).toBeNull();
  });

  it('enables prev to an unlocked neighbour and disables next when it is locked', async () => {
    listLessons.mockResolvedValue([
      lesson({ id: 'l1', title: 'Lesson One', position: 0 }),
      lesson({ id: 'l2', title: 'Lesson Two', position: 1 }),
      lesson({ id: 'l3', title: 'Lesson Three', position: 2, status: 'DRAFT' }),
    ]);
    listGroupProgress.mockResolvedValue([]);

    renderNav();

    // Prev → l1 (READY): a navigable link.
    const prev = await screen.findByText('Oldingi');
    expect(prev.closest('a')).toHaveAttribute('href', '/en/lessons/l1');

    // Next → l3 (DRAFT/locked): rendered disabled, not a link.
    const next = screen.getByText('Keyingi');
    expect(next.closest('a')).toBeNull();
    expect(next.closest('button')).toBeDisabled();
  });
});
