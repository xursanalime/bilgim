import { act, fireEvent, render, screen } from '@testing-library/react';

import { CaptureGuard, ProtectedSurface } from './protected-surface';

/**
 * Tests for the consolidated capture-deterrence wrapper (Req 4.1, 4.2, 4.3, 4.5).
 *
 * Coverage:
 *  - selection / copy / cut / context-menu / drag are prevented in the surface;
 *  - window blur + tab hidden → content obscured AND onPause fired;
 *  - focus / visible again → restored AND onResume fired (non-spammy);
 *  - the obscure overlay is aria-hidden and never intercepts pointer events;
 *  - `prefers-reduced-motion` disables the blur transition (no harsh flashing).
 */

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

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    writable: true,
    configurable: true,
    value: hidden,
  });
}

describe('ProtectedSurface', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    setDocumentHidden(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setDocumentHidden(false);
  });

  it('prevents context menu, copy, cut, selection and drag within the surface (Req 4.1)', () => {
    render(
      <ProtectedSurface>
        <p>protected body</p>
      </ProtectedSurface>,
    );
    const content = screen.getByTestId('protected-content');

    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.contextMenu(content)).toBe(false);
    expect(fireEvent.copy(content)).toBe(false);
    expect(fireEvent.cut(content)).toBe(false);
    expect(fireEvent.dragStart(content)).toBe(false);

    const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    content.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(true);
  });

  it('tags the surface for the globals.css selection rules', () => {
    render(
      <ProtectedSurface>
        <span>x</span>
      </ProtectedSurface>,
    );
    expect(screen.getByTestId('protected-surface')).toHaveAttribute(
      'data-content-protected',
      'true',
    );
  });

  it('obscures the frame and calls onPause when the window loses focus (Req 4.2)', () => {
    const onPause = jest.fn();
    const onResume = jest.fn();
    render(
      <ProtectedSurface onPause={onPause} onResume={onResume}>
        <span>x</span>
      </ProtectedSurface>,
    );

    expect(screen.queryByTestId('protected-obscure-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('protected-content').style.filter).toBe('none');

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByTestId('protected-obscure-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('protected-content').style.filter).toContain('blur');
  });

  it('obscures when the tab becomes hidden via visibilitychange (Req 4.2)', () => {
    const onPause = jest.fn();
    render(
      <ProtectedSurface onPause={onPause}>
        <span>x</span>
      </ProtectedSurface>,
    );

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('protected-obscure-overlay')).toBeInTheDocument();
  });

  it('restores and calls onResume when focus returns (Req 4.2)', () => {
    const onPause = jest.fn();
    const onResume = jest.fn();
    render(
      <ProtectedSurface onPause={onPause} onResume={onResume}>
        <span>x</span>
      </ProtectedSurface>,
    );

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.getByTestId('protected-obscure-overlay')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1); // not fired again — non-spammy
    expect(screen.queryByTestId('protected-obscure-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('protected-content').style.filter).toBe('none');
  });

  it('keeps the obscure overlay out of the a11y tree and non-interactive (Req 4.5)', () => {
    render(
      <ProtectedSurface>
        <span>x</span>
      </ProtectedSurface>,
    );
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    const overlay = screen.getByTestId('protected-obscure-overlay');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('exposes a single polite live region for the obscure state (Req 4.5)', () => {
    render(
      <ProtectedSurface>
        <span>x</span>
      </ProtectedSurface>,
    );
    const region = screen.getByTestId('protected-live-region');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(region.textContent).not.toBe('');
  });

  it('disables the blur transition under prefers-reduced-motion (Req 4.5)', () => {
    mockMatchMedia(true);
    render(
      <ProtectedSurface>
        <span>x</span>
      </ProtectedSurface>,
    );
    expect(screen.getByTestId('protected-content').style.transition).toBe('none');
  });

  it('does nothing and never obscures when disabled', () => {
    const onPause = jest.fn();
    render(
      <ProtectedSurface disabled onPause={onPause}>
        <span>x</span>
      </ProtectedSurface>,
    );
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(onPause).not.toHaveBeenCalled();
    expect(screen.queryByTestId('protected-obscure-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('protected-surface')).not.toHaveAttribute(
      'data-content-protected',
    );
  });

  it('CaptureGuard is an alias of ProtectedSurface', () => {
    expect(CaptureGuard).toBe(ProtectedSurface);
  });
});
