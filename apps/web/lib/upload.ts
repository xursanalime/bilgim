import { mediaApi, type MediaKind } from './api/media';

/**
 * Uploads a file using the R2 multipart flow.
 * For files under 5MB, it uses a single part.
 */
export async function uploadFile(
  file: File, 
  kind: MediaKind, 
  onProgress?: (percent: number) => void
): Promise<string> {
  const partSize = 5 * 1024 * 1024; // 5MB
  const partsCount = Math.ceil(file.size / partSize) || 1;

  // 1. Initiate
  const init = await mediaApi.initUpload({
    kind,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    partsCount,
  });

  const etags: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  // 2. Upload parts
  for (let i = 0; i < partsCount; i++) {
    const start = i * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);
    const part = init.partUrls[i];
    if (!part) throw new Error(`Missing part URL for index ${i}`);
    const { url, partNumber } = part;

    const response = await fetch(url, {
      method: 'PUT',
      body: chunk,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to upload part ${partNumber}`);
    }

    const etag = response.headers.get('ETag');
    if (!etag) {
      throw new Error(`Missing ETag for part ${partNumber}`);
    }

    etags.push({ partNumber, etag: etag.replace(/"/g, '') });
    
    uploadedBytes += chunk.size;
    if (onProgress) {
      onProgress(Math.round((uploadedBytes / file.size) * 100));
    }
  }

  // 3. Complete
  await mediaApi.completeUpload(init.assetId, {
    parts: etags,
  });

  return init.assetId;
}

export function getMediaKind(file: File): MediaKind {
  const type = file.type;
  if (type.startsWith('image/')) return 'IMAGE';
  if (type.startsWith('video/')) return 'VIDEO';
  if (type.startsWith('audio/')) return 'AUDIO';
  if (type === 'application/pdf') return 'PDF';
  if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'DOC';
  }
  if (
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'SHEET';
  }
  return 'OTHER';
}
