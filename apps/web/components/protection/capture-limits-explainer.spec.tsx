import { fireEvent, render, screen } from '@testing-library/react';

import { CaptureLimitsExplainer } from './capture-limits-explainer';

/**
 * Tests for the instructor-facing honest limits explainer (Req 4.4, 1.6).
 *
 * Focus: it explains what protection does and does NOT do, is an accessible
 * disclosure, and NEVER makes an absolute-prevention claim.
 */

const OVERPROMISE_PATTERNS: RegExp[] = [
  /100\s*%/i,
  /cannot be captured/i,
  /impossible/i,
  /to['‘’]liq himoyalangan/i, // "fully protected" (uz)
];

describe('CaptureLimitsExplainer', () => {
  it('renders the heading and an honest summary', () => {
    render(<CaptureLimitsExplainer />);
    expect(
      screen.getByRole('button', { name: /kontent himoyasi/i }),
    ).toBeInTheDocument();
  });

  it('is collapsed by default and expands on click', () => {
    render(<CaptureLimitsExplainer />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Both "does" and "does not" sections become visible.
    expect(screen.getByText('Himoya nima qiladi')).toBeInTheDocument();
    expect(screen.getByText('Himoya nimani kafolatlay olmaydi')).toBeInTheDocument();
  });

  it('honestly states web capture cannot be fully prevented', () => {
    render(<CaptureLimitsExplainer defaultOpen />);
    expect(
      screen.getAllByText(/to['‘’]liq to['‘’]xtatib bo['‘’]lmaydi/i).length,
    ).toBeGreaterThan(0);
    // Notes the native mobile asymmetry (FLAG_SECURE stronger than web).
    expect(screen.getByText(/FLAG_SECURE/)).toBeInTheDocument();
  });

  it('does NOT contain any absolute-prevention claim', () => {
    const { container } = render(<CaptureLimitsExplainer defaultOpen />);
    const text = container.textContent ?? '';
    for (const pattern of OVERPROMISE_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });
});
