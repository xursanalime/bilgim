/**
 * Shared TanStack Query keys for the homework grading surfaces
 * (frontend-redesign Task 6.4). Centralized so the grading queue and the
 * grading panel invalidate the exact same cache entries.
 */
export const homeworkQueryKeys = {
  assignment: (assignmentId: string) =>
    ['homework', 'assignment', assignmentId] as const,
  assignmentSubmissions: (assignmentId: string) =>
    ['homework', 'assignment-submissions', assignmentId] as const,
  submission: (submissionId: string) =>
    ['homework', 'submission', submissionId] as const,
  /** Calling student's own submission for a given assignment (or null). */
  mySubmission: (assignmentId: string) =>
    ['homework', 'submission', 'me', assignmentId] as const,
};
