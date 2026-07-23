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
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPE[ext] ?? 'application/octet-stream';
}
