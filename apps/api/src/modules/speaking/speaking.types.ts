/**
 * Shared types and constants for the Speaking_Assessment_Module
 * (Phase 4, Req 7.1, 7.2, 7.7).
 *
 * The audio content-type allowlist is intentionally derived from the
 * Media_Module's canonical `ALLOWED_MIME_BY_KIND.AUDIO` list rather than
 * being redeclared here — the requirement (7.7) is that speaking
 * submissions accept "only audio MediaAsset content types permitted by
 * the Media_Module allowlist". Reusing the same source of truth keeps
 * the two modules from drifting apart.
 */

import { ALLOWED_MIME_BY_KIND } from '../media/media.types';

/**
 * The two `HomeworkModuleType` values that accept an audio recording as
 * the learner's answer. SPEAKING/PRONUNCIATION are the only module types
 * the Speaking_Assessment_Module operates on (Req 7.1).
 */
export const SPEAKING_MODULE_TYPES = ['SPEAKING', 'PRONUNCIATION'] as const;

export type SpeakingModuleType = (typeof SPEAKING_MODULE_TYPES)[number];

/**
 * Audio content types accepted for a speaking/pronunciation submission
 * (Req 7.7). This is a direct alias of the Media_Module AUDIO allowlist
 * — currently `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/ogg`,
 * `audio/webm`. The service re-checks against this list before any
 * MediaAsset is created so a rejected content type never reaches
 * storage.
 */
export const SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES: readonly string[] =
  ALLOWED_MIME_BY_KIND.AUDIO;

/**
 * Per-recording size cap (50 MiB). Far below the Media_Module's generic
 * 5 GiB cap — a spoken homework answer is at most a few minutes of
 * compressed audio, so a tighter bound keeps abusive uploads out of the
 * pipeline while leaving plenty of headroom for an uncompressed WAV
 * answer.
 */
export const SPEAKING_AUDIO_MAX_SIZE_BYTES = 50 * 1024 * 1024;

/** Narrowing helper — is `value` one of the speaking module types? */
export function isSpeakingModuleType(
  value: string,
): value is SpeakingModuleType {
  return (SPEAKING_MODULE_TYPES as readonly string[]).includes(value);
}

/** Is `contentType` permitted by the audio allowlist (Req 7.7)? */
export function isAllowedSpeakingAudioContentType(
  contentType: string,
): boolean {
  return SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES.includes(contentType);
}

/**
 * Shape of the audio answer slice stored inside `Submission.answersJson`
 * under the speaking module's id (Req 7.2 — the AUDIO MediaAsset is
 * associated with the Submission). Mirrors the per-module `answersJson`
 * convention used by the rest of the Homework module.
 */
export interface SpeakingAudioAnswer {
  /** Discriminator so a grader can tell this slice carries audio. */
  kind: 'AUDIO';
  /** The AUDIO MediaAsset id created via the Media_Module. */
  assetId: string;
  /** Echoed content type (already allowlist-validated). */
  contentType: string;
  /** Sanitized client-supplied file name (informational). */
  fileName: string;
  /** Lifecycle hint — the asset is still being uploaded to storage. */
  status: 'UPLOADING';
  /** ISO timestamp the audio answer was registered against the submission. */
  registeredAt: string;
}
