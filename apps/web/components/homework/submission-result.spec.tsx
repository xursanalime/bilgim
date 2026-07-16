import { render, screen } from '@testing-library/react';

import { SubmissionResult } from './submission-result';
import type { Submission } from '../../lib/api/homework';

function sub(overrides: Partial<Submission>): Submission {
  return {
    id: 's-1',
    assignmentId: 'asg-1',
    studentId: 'stu-1',
    enrollmentId: null,
    status: 'GRADED',
    answersJson: null,
    score: 85,
    aiFlagged: false,
    aiLikelihood: null,
    submittedAt: '2024-01-01T10:00:00.000Z',
    gradedAt: '2024-01-02T10:00:00.000Z',
    createdAt: '2024-01-01T09:00:00.000Z',
    updatedAt: '2024-01-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('SubmissionResult', () => {
  it('renders the score, total, and percentage once graded', () => {
    render(
      <SubmissionResult
        submission={sub({ score: 85 })}
        totalPoints={100}
        assignmentTitle="Essay topshirigi"
      />,
    );

    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('/100')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Essay topshirigi')).toBeInTheDocument();
  });

  it('renders teacher feedback comments when present', () => {
    render(
      <SubmissionResult
        submission={sub({
          score: 70,
          feedback: [
            { comment: 'Yaxshi tuzilgan' },
            { comment: '' },
            { comment: 'Grammatikani tekshiring' },
          ],
        })}
        totalPoints={100}
      />,
    );

    expect(screen.getByText('Yaxshi tuzilgan')).toBeInTheDocument();
    expect(screen.getByText('Grammatikani tekshiring')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no written feedback', () => {
    render(<SubmissionResult submission={sub({})} totalPoints={100} />);
    expect(
      screen.getByText('Oʻqituvchi yozma izoh qoldirmagan.'),
    ).toBeInTheDocument();
  });

  it('renders nothing until the submission is graded', () => {
    const { container } = render(
      <SubmissionResult
        submission={sub({ status: 'SUBMITTED', score: null })}
        totalPoints={100}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('warns when the graded submission was AI-flagged', () => {
    render(
      <SubmissionResult
        submission={sub({ aiFlagged: true })}
        totalPoints={100}
      />,
    );
    expect(screen.getByText(/AI yordamida yozilgan/)).toBeInTheDocument();
  });
});
