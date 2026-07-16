import { fireEvent, render, screen } from '@testing-library/react';

import { LevelUpToast } from './level-up-toast';
import type { GamificationProfile } from '../../lib/api/gamification';

/**
 * Tests for the level-up affirmation (Requirement 12.2).
 *
 * Coverage:
 *  - no affirmation on the first observed profile (baseline, avoids firing
 *    on page refresh);
 *  - a celebratory affirmation appears (announced via role="status") when
 *    the Learner crosses into a higher level;
 *  - `prefers-reduced-motion` disables the decorative sparkle animation
 *    while still surfacing the affirmation;
 *  - non-learner roles never see the affirmation;
 *  - the dismiss button removes the affirmation.
 */

// react-query is mocked so we can drive `profile` deterministically.
let mockProfile: GamificationProfile | null = null;
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockProfile }),
}));

// jsdom has no matchMedia — provide a controllable mock (default: motion ok).
function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: reduced,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function profileAtXp(totalXp: number): GamificationProfile {
  return {
    userId: 'u1',
    role: 'STUDENT',
    totalXp,
    weeklyXp: 0,
    currentLevel: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    freezesLeft: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockMatchMedia(false);
  mockProfile = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('LevelUpToast', () => {
  it('shows nothing on the first observed profile (baseline)', () => {
    mockProfile = profileAtXp(0); // student level 1
    render(<LevelUpToast role="STUDENT" locale="uz" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces a celebratory affirmation when the level increases', () => {
    mockProfile = profileAtXp(0); // level 1 baseline
    const { rerender } = render(<LevelUpToast role="STUDENT" locale="uz" />);
    expect(screen.queryByRole('status')).toBeNull();

    mockProfile = profileAtXp(300); // crosses into level 2
    rerender(<LevelUpToast role="STUDENT" locale="uz" />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    // Level 2 name from STUDENT_LEVELS.
    expect(screen.getByText('Qiziquvchan')).toBeInTheDocument();
  });

  it('disables the decorative sparkle animation under prefers-reduced-motion (Req 12.2)', () => {
    mockMatchMedia(true);
    mockProfile = profileAtXp(0);
    const { rerender } = render(<LevelUpToast role="STUDENT" locale="uz" />);

    mockProfile = profileAtXp(300);
    rerender(<LevelUpToast role="STUDENT" locale="uz" />);

    // Affirmation is still surfaced and announced...
    expect(screen.getByRole('status')).toBeInTheDocument();
    // ...but the animated sparkle is not rendered.
    expect(screen.queryByTestId('levelup-sparkle')).toBeNull();
  });

  it('renders the decorative sparkle when motion is allowed', () => {
    mockMatchMedia(false);
    mockProfile = profileAtXp(0);
    const { rerender } = render(<LevelUpToast role="STUDENT" locale="uz" />);

    mockProfile = profileAtXp(300);
    rerender(<LevelUpToast role="STUDENT" locale="uz" />);

    expect(screen.getByTestId('levelup-sparkle')).toBeInTheDocument();
  });

  it('never renders for non-learner roles', () => {
    mockProfile = profileAtXp(0);
    const { rerender } = render(<LevelUpToast role="TEACHER" locale="uz" />);

    mockProfile = profileAtXp(300);
    rerender(<LevelUpToast role="TEACHER" locale="uz" />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismisses the affirmation when the close button is pressed', () => {
    mockProfile = profileAtXp(0);
    const { rerender } = render(<LevelUpToast role="STUDENT" locale="uz" />);

    mockProfile = profileAtXp(300);
    rerender(<LevelUpToast role="STUDENT" locale="uz" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yopish' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
