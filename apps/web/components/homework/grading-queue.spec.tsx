import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { GradingQueue } from './grading-queue';
import { homeworkApi, type Submission } from '../../lib/api/homework';

jest.mock('../../lib/api/homework', () => ({
  homeworkApi: {
    getAssignment: jest.fn(),
    listForAssignment: jest.fn(),
    grade: jest.fn(),
    returnToStudent: jest.fn(),
    gradePrecheck: jest.fn(),
  },
}));

const getAssignment = homeworkApi.getAssignment as jest.Mock;
const listForAssignment = homeworkApi.listForAssignment as jest.Mock;
const grade = homeworkApi.grade as jest.Mock;
const returnToStudent = homeworkApi.returnToStudent as jest.Mock;

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function sub(overrides: Partial<Submission> & { id: string }): Submission {
  return {
    assignmentId: 'asg-1',
    studentId: `stu-${overrides.id}`,
    enrollmentId: null,
    status: 'SUBMITTED',
    answersJson: { m1: { text: 'My essay answer' } },
    score: null,
    aiFlagged: false,
    aiLikelihood: null,
    submittedAt: '2024-01-01T10:00:00.000Z',
    gradedAt: null,
    createdAt: '2024-01-01T09:00:00.000Z',
    updatedAt: '2024-01-01T10:00:00.000Z',
    student: {
      user: {
        id: `u-${overrides.id}`,
        fullName: `Talaba ${overrides.id}`,
        avatarUrl: null,
        email: `${overrides.id}@example.com`,
      },
    },
    ...overrides,
  };
}

const assignment = {
  id: 'asg-1',
  lessonId: 'les-1',
  title: 'Essay topshirigi',
  description: null,
  dueAt: null,
  totalPoints: 100,
  isPublished: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  modules: [],
};

describe('GradingQueue', () => {
  beforeEach(() => {
    getAssignment.mockReset();
    listForAssignment.mockReset();
    grade.mockReset();
    returnToStudent.mockReset();
    getAssignment.mockResolvedValue(assignment);
  });

  it('defaults to the pending filter and shows AI-likelihood badges', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'a', status: 'SUBMITTED', aiFlagged: true, aiLikelihood: 0.82 }),
      sub({ id: 'b', status: 'GRADED', score: 90 }),
    ]);

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    // Pending filter: SUBMITTED shows, GRADED hidden.
    expect(await screen.findByText('Talaba a')).toBeInTheDocument();
    expect(screen.queryByText('Talaba b')).not.toBeInTheDocument();

    // AI likelihood badge rendered for the flagged submission.
    expect(screen.getByText('AI 82%')).toBeInTheDocument();
  });

  it('filters by GRADED status and shows the final score', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'a', status: 'SUBMITTED' }),
      sub({ id: 'b', status: 'GRADED', score: 90, gradedAt: '2024-01-02T00:00:00.000Z' }),
    ]);

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    await screen.findByText('Talaba a');
    await userEvent.click(screen.getByRole('button', { name: 'Baholangan' }));

    expect(await screen.findByText('Talaba b')).toBeInTheDocument();
    expect(screen.queryByText('Talaba a')).not.toBeInTheDocument();
    expect(screen.getByText('90/100')).toBeInTheDocument();
  });

  it('filters to AI-flagged submissions only', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'a', status: 'SUBMITTED', aiFlagged: false, aiLikelihood: 0.1 }),
      sub({ id: 'b', status: 'SUBMITTED', aiFlagged: true, aiLikelihood: 0.9 }),
    ]);

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    await screen.findByText('Talaba a');
    await userEvent.click(screen.getByLabelText(/AI belgilangan/i));

    await waitFor(() =>
      expect(screen.queryByText('Talaba a')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Talaba b')).toBeInTheDocument();
  });

  it('finalizes a grade through the expanded panel', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'a', status: 'SUBMITTED' }),
    ]);
    grade.mockResolvedValue(sub({ id: 'a', status: 'GRADED', score: 75 }));

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    const row = (await screen.findByText('Talaba a')).closest('button')!;
    await userEvent.click(row);

    const scoreInput = await screen.findByLabelText(/Ball \(0-100\)/);
    await userEvent.clear(scoreInput);
    await userEvent.type(scoreInput, '75');

    const feedback = screen.getByLabelText('Izoh');
    await userEvent.type(feedback, 'Yaxshi ish');

    await userEvent.click(
      screen.getByRole('button', { name: 'Bahoni yakunlash' }),
    );

    await waitFor(() => {
      expect(grade).toHaveBeenCalledWith('a', {
        score: 75,
        feedback: [{ comment: 'Yaxshi ish' }],
      });
    });
  });

  it('returns a submission to the student', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'a', status: 'IN_REVIEW' }),
    ]);
    returnToStudent.mockResolvedValue(sub({ id: 'a', status: 'RETURNED' }));

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    const row = (await screen.findByText('Talaba a')).closest('button')!;
    await userEvent.click(row);

    const comment = await screen.findByLabelText('Talabaga qaytarish');
    await userEvent.type(comment, 'Qayta koʻrib chiqing');

    await userEvent.click(
      screen.getByRole('button', { name: 'Talabaga qaytarish' }),
    );

    await waitFor(() => {
      expect(returnToStudent).toHaveBeenCalledWith('a', {
        comment: 'Qayta koʻrib chiqing',
      });
    });
  });

  it('shows an empty state when no submissions match the filter', async () => {
    listForAssignment.mockResolvedValue([
      sub({ id: 'b', status: 'GRADED', score: 90 }),
    ]);

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    // Default PENDING filter excludes the only (GRADED) submission.
    expect(await screen.findByText('Topshiriq topilmadi')).toBeInTheDocument();
  });

  it('surfaces an actionable error state when the list fails', async () => {
    listForAssignment.mockRejectedValue(new Error('boom'));

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: 'Qayta urinish' }),
    ).toBeInTheDocument();
  });
});

describe('GradingQueue helpers', () => {
  it('uses the same student name lookup for avatar fallback rows', async () => {
    getAssignment.mockResolvedValue(assignment);
    const anon = sub({ id: 'a', status: 'SUBMITTED' });
    delete (anon as { student?: unknown }).student;
    listForAssignment.mockResolvedValue([anon]);

    renderWithClient(<GradingQueue locale="uz" assignmentId="asg-1" />);
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Nomaʼlum talaba')).toBeInTheDocument();
  });
});
