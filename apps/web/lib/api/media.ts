import { apiClient } from '../api-client';

export type MediaKind = 'VIDEO' | 'IMAGE' | 'PDF' | 'DOC' | 'SHEET' | 'AUDIO' | 'OTHER';

export interface InitUploadDto {
  kind: MediaKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  partsCount: number;
}

export interface UploadInitiated {
  assetId: string;
  uploadId: string;
  key: string;
  partUrls: { partNumber: number; url: string }[];
  expiresInSeconds: number;
  partSizeBytes: number;
}

export interface CompleteUploadPart {
  partNumber: number;
  etag: string;
}

export interface CompleteUploadDto {
  parts: CompleteUploadPart[];
}

export interface UploadCompleted {
  assetId: string;
  status: 'UPLOADED';
  key: string;
}

export interface MediaPlaybackUrl {
  role: 'manifest' | 'variant' | 'original';
  key: string;
  url: string;
  variant?: string;
}

export interface MediaPlaybackResponse {
  assetId: string;
  kind: MediaKind;
  status: string;
  url: string;
  type: 'manifest' | 'variant' | 'original';
  urls: MediaPlaybackUrl[];
  expiresInSeconds: number;
  expiresAt: string;
}

export interface MediaAssetMetadata {
  id: string;
  kind: MediaKind;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  status: string;
}

export const mediaApi = {
  initUpload(dto: InitUploadDto) {
    return apiClient.post<UploadInitiated>('/media/uploads', dto);
  },

  completeUpload(assetId: string, dto: CompleteUploadDto) {
    return apiClient.post<UploadCompleted>(`/media/uploads/${assetId}/complete`, dto);
  },

  getPlaybackUrl(assetId: string, expiresIn?: number) {
    return apiClient.get<MediaPlaybackResponse>(`/media/assets/${assetId}/url`, {
      params: expiresIn ? { expiresIn } : {},
    });
  },

  getAssetMetadata(assetId: string) {
    return apiClient.get<MediaAssetMetadata>(`/media/assets/${assetId}`);
  },
};
