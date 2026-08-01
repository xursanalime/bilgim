/**
 * Browsers don't always populate `File.type` for every format — Chromium
 * on Windows/Linux commonly reports an empty string for `.mov` (no
 * registered MIME mapping on those OSes), while Safari/macOS reports
 * `video/quicktime`. An empty `contentType` reaching the API gets
 * classified as `kind=OTHER`, which the backend's upload allowlist
 * rejects outright (`ALLOWED_MIME_BY_KIND.OTHER` is empty) — so a real
 * video looks "unsupported". Fall back to the file extension whenever
 * the browser didn't report a type.
 */
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
};

export function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPE[ext] ?? 'application/octet-stream';
}

/**
 * Magic-number signatures for the formats chat attachments actually use.
 * Checked in order; each entry's bytes must match at `offset`.
 */
const SIGNATURES: {
  contentType: string;
  offset: number;
  bytes: number[];
}[] = [
  { contentType: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    contentType: 'image/png',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { contentType: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { contentType: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // Also matches docx/xlsx/pptx (all zip containers) — fine here, since
  // the caller only reaches for this when the extension didn't already
  // resolve a more specific type.
  { contentType: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
];

function bytesMatch(buf: Uint8Array, offset: number, expected: number[]): boolean {
  if (buf.length < offset + expected.length) return false;
  return expected.every((b, i) => buf[offset + i] === b);
}

function asciiAt(buf: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...buf.subarray(offset, offset + length));
}

/**
 * Reads a file's first bytes and matches them against known format
 * signatures. Used as a last resort when neither `File.type` nor the file
 * extension identified the format — common for photos/videos saved from
 * chat apps or social feeds, which often arrive with a generic or missing
 * extension. Returns `null` when nothing recognizable is found.
 */
async function sniffContentType(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  for (const sig of SIGNATURES) {
    if (bytesMatch(head, sig.offset, sig.bytes)) return sig.contentType;
  }

  // RIFF....WEBP
  if (
    head.length >= 12 &&
    asciiAt(head, 0, 4) === 'RIFF' &&
    asciiAt(head, 8, 4) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // ISO base media (MP4/MOV/M4A family): `ftyp` box at offset 4. The major
  // brand at offset 8 tells mov apart from everything else, which browsers
  // and this app's allow-list both treat as plain mp4.
  if (head.length >= 12 && asciiAt(head, 4, 4) === 'ftyp') {
    return asciiAt(head, 8, 4).startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  }

  // EBML container — WebM and Matroska share this signature; WebM is the
  // one browsers actually play natively, so it's the safer default.
  if (bytesMatch(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return 'video/webm';
  }

  return null;
}

/**
 * Like `resolveContentType`, but falls back to sniffing the file's magic
 * number when `File.type` is empty and the extension is unrecognized. Only
 * worth the extra read when the cheap checks already failed, so callers
 * that can tolerate an async call (uploads) should prefer this over the
 * sync version.
 */
export async function resolveContentTypeWithSniff(file: File): Promise<string> {
  const cheap = resolveContentType(file);
  if (cheap !== 'application/octet-stream') return cheap;
  const sniffed = await sniffContentType(file);
  return sniffed ?? cheap;
}
