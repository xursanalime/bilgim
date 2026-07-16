'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAudioRecorder — a thin, dependency-free wrapper around the native
 * `MediaRecorder` API for capturing short learner audio answers
 * (frontend-redesign Req 10.4, Task 6.3 — SPEAKING / PRONUNCIATION).
 *
 * It exposes a small state machine plus the recorded `Blob` and a local
 * object URL for instant playback. Microphone permission denial and
 * unsupported browsers are surfaced as explicit terminal states so the
 * UI can degrade gracefully (no recorder, learner can still leave a note).
 *
 * The hook owns all browser resources (the `MediaStream`, the object URL,
 * and the elapsed-time interval) and tears them down on `reset()` and on
 * unmount so nothing leaks if the learner navigates away mid-recording.
 */

export type AudioRecorderStatus =
  | 'idle'
  | 'unsupported'
  | 'requesting'
  | 'recording'
  | 'recorded'
  | 'denied'
  | 'error';

export interface AudioRecording {
  /** The captured audio blob, ready to wrap in a `File` for upload. */
  blob: Blob;
  /** A local `object:` URL for immediate playback (revoked on reset/unmount). */
  url: string;
  /** The MIME type the recorder produced. */
  mimeType: string;
  /** Wall-clock recording length in milliseconds. */
  durationMs: number;
}

/**
 * Preference-ordered list of container/codec combos. Opus in WebM is the
 * most broadly supported on Chromium/Firefox; `audio/mp4` covers Safari.
 */
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
] as const;

/** Is the native recording stack available in this environment? */
export function isAudioRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/**
 * Pick the first candidate MIME type the platform's `MediaRecorder`
 * supports. Pure + injectable (`isTypeSupported`) so it is unit-testable
 * without a real `MediaRecorder`. Returns `undefined` when none match, in
 * which case callers should let the browser choose its own default.
 */
export function pickSupportedMimeType(
  candidates: readonly string[] = CANDIDATE_MIME_TYPES,
  isTypeSupported?: (type: string) => boolean,
): string | undefined {
  const check =
    isTypeSupported ??
    (typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof window.MediaRecorder.isTypeSupported === 'function'
      ? (type: string) => window.MediaRecorder.isTypeSupported(type)
      : undefined);
  if (!check) return undefined;
  return candidates.find((type) => check(type));
}

/** Map a recorder MIME type to a sensible file extension for the upload name. */
export function fileExtensionForMime(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) {
    return 'm4a';
  }
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  return 'dat';
}

/** Format a millisecond duration as `m:ss` for the recording timer. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface UseAudioRecorderResult {
  status: AudioRecorderStatus;
  recording: AudioRecording | null;
  errorMessage: string | null;
  /** Elapsed time of the in-progress (or last) recording, in ms. */
  elapsedMs: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = useState<AudioRecorderStatus>(() =>
    isAudioRecordingSupported() ? 'idle' : 'unsupported',
  );
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!isAudioRecordingSupported()) {
      setStatus('unsupported');
      return;
    }
    setErrorMessage(null);
    revokeUrl();
    setRecording(null);
    setElapsedMs(0);
    setStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        clearTimer();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const durationMs = Date.now() - startedAtRef.current;
        setRecording({ blob, url, mimeType: type, durationMs });
        setElapsedMs(durationMs);
        setStatus('recorded');
        stopStream();
      };
      recorder.onerror = () => {
        clearTimer();
        setStatus('error');
        setErrorMessage('Ovoz yozishda xatolik yuz berdi. Qayta urinib koʻring.');
        stopStream();
      };

      startedAtRef.current = Date.now();
      recorder.start();
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      stopStream();
      const name = err instanceof DOMException ? err.name : '';
      if (
        name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        name === 'PermissionDeniedError'
      ) {
        setStatus('denied');
        setErrorMessage(
          'Mikrofonga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.',
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setStatus('error');
        setErrorMessage('Mikrofon topilmadi. Qurilmangizni tekshiring.');
      } else {
        setStatus('error');
        setErrorMessage('Mikrofonni ishga tushirib boʻlmadi.');
      }
    }
  }, [clearTimer, revokeUrl, stopStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    stopStream();
    revokeUrl();
    setRecording(null);
    setElapsedMs(0);
    setErrorMessage(null);
    setStatus(isAudioRecordingSupported() ? 'idle' : 'unsupported');
  }, [clearTimer, revokeUrl, stopStream]);

  useEffect(() => {
    return () => {
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      stopStream();
      revokeUrl();
    };
  }, [clearTimer, stopStream, revokeUrl]);

  return { status, recording, errorMessage, elapsedMs, start, stop, reset };
}
