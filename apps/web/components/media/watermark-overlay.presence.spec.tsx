/**
 * Watermark PRESENCE over protected playback (Req 3.1).
 *
 * Complements `watermark-overlay.spec.tsx` (which drives the overlay with
 * literal labels) by asserting the end-to-end DATA FLOW that matters for the
 * forensic guarantee: the watermark label rendered over playback is the
 * SERVER-DERIVED `ticket.watermark.label` carried by the Playback_Ticket — it
 * is passed through verbatim and never reconstructed from client identity
 * (Req 3.1, 3.3).
 *
 * Why test the overlay (not `ProtectedVideoPlayer`) for presence: under jsdom
 * there is no EME/CDM, so the protected player correctly FAILS CLOSED and never
 * reaches the `drm === 'ready'` state that mounts the watermark. The faithful,
 * deterministic component-level assertion is therefore: given a real ticket's
 * server-derived label, the overlay renders it, above the frame, without
 * intercepting controls.
 */
import { render, screen } from '@testing-library/react';

import { WatermarkOverlay } from './watermark-overlay';
import { MockMediaProtectionProvider } from '../../lib/media/protection';

// jsdom has no matchMedia — provide a minimal mock (motion ok).
function mockMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
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

describe('WatermarkOverlay — presence over protected playback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders the server-derived ticket watermark label verbatim', async () => {
    // The label originates from the (mock) protection provider's ticket,
    // standing in for the server-minted Playback_Ticket.
    const provider = new MockMediaProtectionProvider();
    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-xyz' });

    render(<WatermarkOverlay label={ticket.watermark.label} />);

    // The exact server-derived label is present in the DOM.
    expect(screen.getByText(ticket.watermark.label)).toBeInTheDocument();
    // Sanity: the label is the asset-bound, server-side string (not empty).
    expect(ticket.watermark.label.length).toBeGreaterThan(0);
  });

  it('renders the watermark ABOVE the frame and never blocks controls', async () => {
    const provider = new MockMediaProtectionProvider();
    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-xyz' });

    render(<WatermarkOverlay label={ticket.watermark.label} />);

    const container = screen.getByTestId('watermark-overlay');
    const label = screen.getByTestId('watermark-label');

    // Covers the whole frame, stacked above the video, click-through.
    expect(container.style.position).toBe('absolute');
    expect(Number(container.style.zIndex)).toBeGreaterThan(0);
    expect(container.style.pointerEvents).toBe('none');
    expect(label.style.pointerEvents).toBe('none');
    // The moving label is decorative to assistive tech.
    expect(label).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not derive identity client-side: only the passed label appears', () => {
    // If the overlay tried to synthesize identity from client auth state, a
    // raw email/id would leak. It must show ONLY the provided masked label.
    render(<WatermarkOverlay label="masked • sess_001" showTimestamp={false} />);
    expect(screen.getByTestId('watermark-label').textContent).toBe(
      'masked • sess_001',
    );
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
