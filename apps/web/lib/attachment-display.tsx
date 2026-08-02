import { File, FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';

import type { AttachmentKind } from './api/catalog';

/**
 * Shared presentation helpers for lesson attachments — used by both the
 * teacher's materials editor (`lesson-materials.tsx`) and the student's
 * lesson viewer (`lesson-player.tsx`) so the two never drift into looking
 * like different products for the same data.
 */

export const KIND_COLOR: Record<AttachmentKind, string> = {
  VIDEO: 'bg-blue-tint text-blue',
  RECORDING: 'bg-purple-tint text-purple',
  AUDIO: 'bg-purple-tint text-purple',
  IMAGE: 'bg-teal-tint text-teal',
  PDF: 'bg-orange-tint text-orange',
  DOC: 'bg-orange-tint text-orange',
  SHEET: 'bg-teal-tint text-teal',
  OTHER: 'bg-tint text-ink-soft',
};

export function kindIcon(kind: AttachmentKind) {
  switch (kind) {
    case 'VIDEO':
    case 'RECORDING':
      return <FileVideo className="h-4 w-4" />;
    case 'AUDIO':
      return <FileAudio className="h-4 w-4" />;
    case 'IMAGE':
      return <FileImage className="h-4 w-4" />;
    case 'PDF':
    case 'DOC':
      return <FileText className="h-4 w-4" />;
    default:
      return <File className="h-4 w-4" />;
  }
}

interface AttachmentLike {
  id: string;
  kind: string;
  asset: { metadata: unknown };
}

export function attachmentFileName(att: AttachmentLike): string {
  const meta = att.asset.metadata as Record<string, unknown> | null;
  const multipart = meta?.multipart as Record<string, unknown> | undefined;
  if (multipart && typeof multipart.fileName === 'string') {
    return multipart.fileName;
  }
  if (meta && typeof meta.fileName === 'string') {
    return meta.fileName;
  }
  return `${att.kind}-${att.id.slice(0, 8)}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
