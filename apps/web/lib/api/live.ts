import { apiClient } from '../api-client';

export interface LiveSession {
  id: string;
  lessonId: string;
  status: 'SCHEDULED' | 'STARTING' | 'LIVE' | 'ENDED' | 'RECORDING_FAILED';
  roomId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LiveKitRoomSnapshot {
  lessonId: string;
  roomId: string;
  participantCount: number;
}

export interface LiveSessionWithSfu {
  session: LiveSession;
  sfu: LiveKitRoomSnapshot;
}

/**
 * Server-derived, PII-masked per-viewer watermark descriptor.
 *
 * BACKEND ASSUMPTION (Req 3.5): the live `join` endpoint is expected to return
 * a per-viewer forensic watermark `label` (e.g. `"j••@mail.com • a1b2"`),
 * computed server-side from the authenticated viewer + session — never
 * constructed on the client. It is optional here so the web app keeps building
 * until the backend surfaces it; the viewer falls back to a locally-masked
 * label so the overlay is never absent (see `LiveViewer`).
 */
export interface LiveWatermark {
  label: string;
}

export interface JoinSessionResult extends LiveSessionWithSfu {
  token: string;
  role: 'TEACHER' | 'STUDENT';
  /** Server-derived per-viewer forensic watermark (Req 3.5). */
  watermark?: LiveWatermark;
}

/**
 * Recording status as persisted on the backend `Recording` row
 * (`apps/api/src/modules/live/recording/recording.repository.ts`):
 *  - `RECORDING` — capture in progress / not yet finalized.
 *  - `READY`     — finalized successfully; `assetId` points at a protected
 *                  MediaAsset (kind VIDEO/RECORDING) playable on-demand.
 *  - `FAILED`    — finalize failed; the owning LiveSession landed in
 *                  RECORDING_FAILED and there is no playable asset.
 */
export type RecordingStatus = 'RECORDING' | 'READY' | 'FAILED';

/**
 * A live-session recording surfaced inside its lesson for on-demand viewing.
 *
 * Mirrors the backend `Recording` model (lessonId, sessionId, assetId,
 * durationMs, status, createdAt). `assetId` is non-null only when
 * `status === 'READY'`; for failed finalizes it is null and the UI must
 * surface a graceful RECORDING_FAILED state instead of a player.
 */
export interface LessonRecording {
  id: string;
  lessonId: string;
  sessionId: string | null;
  /** Protected MediaAsset id when READY; null for RECORDING/FAILED. */
  assetId: string | null;
  durationMs: number | null;
  status: RecordingStatus;
  createdAt: string;
}

export const liveApi = {
  getOne: (lessonId: string) =>
    apiClient.get<LiveSessionWithSfu>(`/live/sessions/${lessonId}`),

  /** Student: get all active live sessions for enrolled groups. */
  activeForMe: () =>
    apiClient.get<LiveSession[]>(`/live/sessions/active-for-me`),
  
  start: (lessonId: string) => 
    apiClient.post<LiveSessionWithSfu>(`/live/sessions/${lessonId}/start`),
  
  end: (lessonId: string) => 
    apiClient.post<LiveSessionWithSfu>(`/live/sessions/${lessonId}/end`),
  
  join: (lessonId: string) => 
    apiClient.post<JoinSessionResult>(`/live/sessions/${lessonId}/join`),
  
  heartbeat: (lessonId: string) =>
    apiClient.get<LiveSessionWithSfu>(`/live/sessions/${lessonId}`),
  
  getLiveKitToken: (roomName: string) =>
    apiClient.post<{ token: string }>(`/live-stream/token`, { roomName }),

  /**
   * List the recordings produced by a lesson's ENDED live sessions, for
   * on-demand viewing inside the lesson (Req 6.2).
   *
   * BACKEND ASSUMPTION: this expects a read endpoint
   *   `GET /live/lessons/:lessonId/recordings`
   * gated by the same `LessonAccessGuard` used elsewhere in the live module
   * (owning TEACHER, ADMIN auditor, or APPROVED student). It returns the
   * lesson's `Recording` rows — including RECORDING_FAILED finalizes (status
   * `FAILED`, `assetId: null`) so the UI can surface them gracefully — newest
   * first. If/when the backend instead exposes recordings via sessions, this
   * wrapper is the single place to adapt (e.g. map
   * `GET /live/lessons/:lessonId/sessions` filtered to `status === 'ENDED'`
   * with a `recordingAssetId`).
   */
  listRecordings: (lessonId: string) =>
    apiClient.get<LessonRecording[]>(`/live/lessons/${lessonId}/recordings`),
};
