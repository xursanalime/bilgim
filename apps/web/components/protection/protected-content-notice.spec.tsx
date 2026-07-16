import { render, screen } from '@testing-library/react';

import { ProtectedContentNotice } from './protected-content-notice';

/**
 * Tests for the learner-facing "protected & traceable" notice (Req 1.6, 4.4).
 *
 * Focus: it renders the honest protected/traceable copy and NEVER makes an
 * absolute-prevention claim (e.g. "100%", "cannot be captured / impossible").
 */

// Absolute-prevention phrasings that would over-promise — must never appear.
const OVERPROMISE_PATTERNS: RegExp[] = [
  /100\s*%/i,
  /cannot be captured/i,
  /impossible/i,
  /to['‘’]liq to['‘’]xtatib bo['‘’]ladi/i, // "can fully prevent" (uz) — opposite is allowed
  /to['‘’]liq himoyalangan/i, // "fully protected" (uz)
];

describe('ProtectedContentNotice', () => {
  it('renders the honest protected & traceable copy (banner)', () => {
    render(<ProtectedContentNotice />);
    expect(screen.getByText('Himoyalangan kontent')).toBeInTheDocument();
    // Mentions watermark + traceability.
    expect(screen.getByText(/suvli belgi/i)).toBeInTheDocument();
    expect(screen.getByText(/kuzatiladi/i)).toBeInTheDocument();
  });

  it('renders as an accessible note region', () => {
    render(<ProtectedContentNotice />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders a compact badge variant', () => {
    render(<ProtectedContentNotice variant="badge" />);
    expect(screen.getByText('Himoyalangan kontent')).toBeInTheDocument();
  });

  it('does NOT contain any absolute-prevention claim', () => {
    const { container } = render(<ProtectedContentNotice />);
    const text = container.textContent ?? '';
    for (const pattern of OVERPROMISE_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });
});
