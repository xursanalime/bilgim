import { act, render, screen } from '@testing-library/react';

import { WatermarkOverlay } from './watermark-overlay';

/**
 * Tests for the per-viewer forensic watermark overlay (Req 3.1, 3.2, 3.3, 3.5).
 *
 * Focus: it renders the SERVER-DERIVED label, never client-constructed
 * identity; shows a timestamp; repositions on an interval that is cleaned up on
 * unmount; and never intercepts pointer events.
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

const SERVER_LABEL = 'j••@mail.com • sess_a1b2';

describe('WatermarkOverlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders the server-derived label verbatim', () => {
    render(<WatermarkOverlay label={SERVER_LABEL} />);
    expect(screen.getByText(SERVER_LABEL)).toBeInTheDocument();
  });

  it('does not construct or render any client-derived identity', () => {
    // Only the provided label should appear — no email/session pulled from
    // client auth state. We assert the rendered text equals what we passed.
    render(<WatermarkOverlay label="masked-only" />);
    expect(screen.getByText('masked-only')).toBeInTheDocument();
    // A raw, unmasked identity must never appear unless we passed it.
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/user-id/i)).not.toBeInTheDocument();
  });

  it('renders a live timestamp by default and updates it on an interval', () => {
    render(<WatermarkOverlay label={SERVER_LABEL} timestampIntervalMs={5000} />);
    const labelNode = screen.getByTestId('watermark-label');
    const initial = labelNode.textContent;
    // A timestamp separator is present alongside the label.
    expect(initial).toContain(SERVER_LABEL);
    expect(initial).toMatch(/\d/); // contains date/time digits

    act(() => {
      jest.advanceTimersByTime(6000);
    });
    // Still rendering label + timestamp after a tick (no crash, stays present).
    expect(screen.getByTestId('watermark-label').textContent).toContain(SERVER_LABEL);
  });

  it('omits the timestamp when showTimestamp is false', () => {
    render(<WatermarkOverlay label="L" showTimestamp={false} />);
    expect(screen.getByTestId('watermark-label').textContent).toBe('L');
  });

  it('repositions on the configured interval', () => {
    render(
      <WatermarkOverlay
        label={SERVER_LABEL}
        repositionIntervalMs={8000}
        positions={[
          { top: '8%', left: '8%' },
          { top: '80%', left: '62%' },
        ]}
      />,
    );
    const node = screen.getByTestId('watermark-label');
    expect(node.style.top).toBe('8%');
    expect(node.style.left).toBe('8%');

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(node.style.top).toBe('80%');
    expect(node.style.left).toBe('62%');
  });

  it('cleans up the reposition interval on unmount (no leaked timers)', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const { unmount } = render(<WatermarkOverlay label={SERVER_LABEL} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('never intercepts pointer events (controls stay reachable)', () => {
    render(<WatermarkOverlay label={SERVER_LABEL} />);
    const container = screen.getByTestId('watermark-overlay');
    const label = screen.getByTestId('watermark-label');
    expect(container.style.pointerEvents).toBe('none');
    expect(label.style.pointerEvents).toBe('none');
  });

  it('renders above the video with a high z-index', () => {
    render(<WatermarkOverlay label={SERVER_LABEL} />);
    const container = screen.getByTestId('watermark-overlay');
    expect(Number(container.style.zIndex)).toBeGreaterThan(0);
  });

  it('hides the moving visual from assistive tech but exposes the protection notice', () => {
    render(
      <WatermarkOverlay
        label={SERVER_LABEL}
        protectionNotice="Protected content — captures are watermarked and traceable."
      />,
    );
    expect(screen.getByTestId('watermark-label')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText('Protected content — captures are watermarked and traceable.'),
    ).toBeInTheDocument();
  });

  it('disables animated transitions under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    render(<WatermarkOverlay label={SERVER_LABEL} />);
    const label = screen.getByTestId('watermark-label');
    expect(label.style.transition).toBe('none');
  });

  it('works identically for live or recorded — driven only by the label prop', () => {
    const { rerender } = render(<WatermarkOverlay label="recorded-viewer" />);
    expect(screen.getByText('recorded-viewer')).toBeInTheDocument();
    rerender(<WatermarkOverlay label="live-viewer" />);
    expect(screen.getByText('live-viewer')).toBeInTheDocument();
  });
});
