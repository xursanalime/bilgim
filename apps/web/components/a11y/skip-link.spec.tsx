import { render, screen } from '@testing-library/react';

import { SkipLink } from './skip-link';
import { expectNoBasicA11yViolations, findBasicA11yViolations } from '../../lib/test/a11y';

/**
 * Tests for the skip-to-content link (Requirements 19.1, 19.2, 19.3) and a
 * smoke check of the dependency-free a11y helper (lib/test/a11y).
 */

describe('SkipLink', () => {
  it('renders an in-page anchor to the main-content target by default', () => {
    render(<SkipLink />);
    const link = screen.getByRole('link', { name: /skip to main content/i });
    expect(link).toHaveAttribute('href', '#main-content');
  });

  it('targets a custom id when provided', () => {
    render(<SkipLink targetId="primary" />);
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#primary',
    );
  });

  it('is screen-reader hidden until focused (sr-only, visible on focus)', () => {
    render(<SkipLink />);
    const link = screen.getByRole('link');
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });

  it('has no baseline accessibility violations', () => {
    const { container } = render(<SkipLink />);
    expectNoBasicA11yViolations(container);
  });
});

describe('findBasicA11yViolations (helper self-check)', () => {
  it('flags an image without alt and a control without a name', () => {
    const { container } = render(
      <div>
        <img src="/x.png" />
        <button type="button" />
      </div>,
    );
    const rules = findBasicA11yViolations(container).map((v) => v.rule);
    expect(rules).toContain('img-alt');
    expect(rules).toContain('control-name');
  });

  it('passes a well-formed, labelled fragment', () => {
    const { container } = render(
      <div>
        <img src="/x.png" alt="A descriptive label" />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />
        <button type="button">Save</button>
      </div>,
    );
    expect(findBasicA11yViolations(container)).toHaveLength(0);
  });
});
