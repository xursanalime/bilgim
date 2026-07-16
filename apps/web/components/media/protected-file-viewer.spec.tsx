import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';

import { ProtectedFileViewer } from './protected-file-viewer';

/**
 * Tests for ProtectedFileViewer (Req 2.1–2.5, design §3.5).
 *
 * Security-critical assertions:
 *  - bytes are streamed through the same-origin BFF (`/api/media/stream`) and
 *    wrapped in a `blob:` URL — NO signed / raw R2 storage URL ever lands in
 *    the DOM (Req 2.1/2.4);
 *  - `downloadAllowed === false` → no download control, selection + print +
 *    context-menu disabled (Req 2.2/2.5);
 *  - `downloadAllowed === true` → a streamed download action is revealed
 *    (Req 2.3);
 *  - the created blob URL is revoked on unmount.
 */

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
// A raw, signed storage URL of the kind that must NEVER reach the DOM.
const SIGNED_R2_URL =
  'https://bucket.r2.cloudflarestorage.com/asset.pdf?X-Amz-Signature=deadbeef';

const BLOB_URL = 'blob:https://app.local/fake-object-url';

let createObjectURL: jest.Mock;
let revokeObjectURL: jest.Mock;
let fetchMock: jest.Mock;

beforeEach(() => {
  createObjectURL = jest.fn(() => BLOB_URL);
  revokeObjectURL = jest.fn();
  // jsdom has no object-URL implementation — provide controllable mocks.
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    configurable: true,
    value: revokeObjectURL,
  });

  fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    // The component must only ever fetch the same-origin BFF stream endpoint,
    // never the signed vendor URL.
    const url = String(input);
    expect(url).toContain('/api/media/stream?assetId=');
    expect(url).not.toContain('r2');
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob(['%PDF-1.4 fake bytes'], { type: 'application/pdf' }),
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProtectedFileViewer', () => {
  it('streams via the BFF and never serializes a signed/raw storage URL (Req 2.1/2.4)', async () => {
    const { container } = render(
      <ProtectedFileViewer assetId={ASSET_ID} kind="PDF" downloadAllowed={false} />,
    );

    await screen.findByTestId('protected-file-pdf');

    // The fetch went to the same-origin BFF only.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchedUrl = String(fetchMock.mock.calls[0][0]);
    expect(fetchedUrl).toContain(`/api/media/stream?assetId=${ASSET_ID}`);

    // No signed/raw storage URL anywhere in the rendered DOM. (We do NOT ban
    // "https://" outright because the object URL is `blob:https://...` and an
    // svg carries an xmlns — both legitimate and not addressable storage URLs.)
    const html = container.innerHTML;
    expect(html).not.toContain(SIGNED_R2_URL);
    expect(html).not.toContain('r2.cloudflarestorage.com');
    expect(html).not.toContain('X-Amz-Signature');
    expect(html).not.toMatch(/https:\/\/[\w.-]*\.r2\./);
    expect(html).not.toMatch(/https:\/\/[\w.-]+\.amazonaws\.com/);

    // The PDF iframe is sourced from the blob URL, not a raw file URL.
    const iframe = screen.getByTestId('protected-file-pdf') as HTMLIFrameElement;
    const iframeSrc = iframe.getAttribute('src') ?? '';
    expect(iframeSrc.startsWith('blob:')).toBe(true);
  });

  it('renders NO download control and disables selection/print when downloadAllowed=false (Req 2.2/2.5)', async () => {
    render(
      <ProtectedFileViewer
        assetId={ASSET_ID}
        kind="IMAGE"
        downloadAllowed={false}
        fileName="secret.png"
      />,
    );

    await screen.findByTestId('protected-file-image');

    // No download affordance.
    expect(screen.queryByTestId('protected-file-download')).not.toBeInTheDocument();

    const viewer = screen.getByTestId('protected-file-viewer');
    // Selection disabled flag + non-selectable style.
    expect(viewer).toHaveAttribute('data-selection-disabled', 'true');
    expect(viewer).toHaveAttribute('data-download-allowed', 'false');
    expect(viewer.style.userSelect).toBe('none');

    // Context-menu and copy are prevented (deterrence).
    expect(fireEvent.contextMenu(viewer)).toBe(false);
    expect(fireEvent.copy(viewer)).toBe(false);

    // Print/save/copy keyboard shortcuts are blocked.
    const printEvent = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    viewer.dispatchEvent(printEvent);
    expect(printEvent.defaultPrevented).toBe(true);

    // Image is not draggable while restricted.
    const img = screen.getByTestId('protected-file-image') as HTMLImageElement;
    expect(img).toHaveAttribute('draggable', 'false');
  });

  it('reveals a streamed download action when downloadAllowed=true (Req 2.3)', async () => {
    render(
      <ProtectedFileViewer
        assetId={ASSET_ID}
        kind="PDF"
        downloadAllowed
        fileName="notes.pdf"
      />,
    );

    const download = await screen.findByTestId('protected-file-download');
    // Download is sourced from the BFF-streamed blob URL, never a raw URL.
    expect(download).toHaveAttribute('href', BLOB_URL);
    expect(download).toHaveAttribute('download', 'notes.pdf');

    // Selection is not forced off when downloads are allowed.
    expect(screen.getByTestId('protected-file-viewer')).toHaveAttribute(
      'data-selection-disabled',
      'false',
    );
  });

  it('revokes the created blob URL on unmount', async () => {
    const { unmount } = render(
      <ProtectedFileViewer assetId={ASSET_ID} kind="IMAGE" downloadAllowed={false} />,
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });
});
