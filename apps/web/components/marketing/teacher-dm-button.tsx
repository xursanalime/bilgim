'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { dmApi } from '../../lib/api/dm';
import { ApiClientError } from '../../lib/api-client';
import { isAuthenticated } from '../../lib/auth';
import { extractErrorCode } from '../../lib/auth-errors';

interface TeacherDmButtonProps {
  locale: string;
  teacherId: string;
  teacherName: string;
}

/**
 * "Xabar yuborish" button on the public teacher profile.
 *
 * Behavior:
 *   - Unauthenticated visitors are redirected to `/login?callbackUrl=...`
 *     so they come back to the same profile after signing in.
 *   - Authenticated students POST to `/dm/threads` (lazily creates the
 *     thread, Req 13.1) and then route into the dashboard inbox.
 *   - The 24h pre-reciprocation rate limit (Property 11) is enforced on
 *     the API; we surface a friendly Uzbek toast if the API responds
 *     with `DM_RATE_LIMITED` (or any 429), but never re-implement the
 *     limit on the client.
 */
export function TeacherDmButton({
  locale,
  teacherId,
  teacherName,
}: TeacherDmButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);

    if (!isAuthenticated()) {
      const callback = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '',
      );
      router.push(`/${locale}/login?callbackUrl=${callback}`);
      return;
    }

    setPending(true);
    try {
      const result = await dmApi.openThread(teacherId);
      router.push(`/${locale}/messages/${result.thread.id}`);
    } catch (err) {
      setError(translateDmError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={`${teacherName} ga xabar yuborish`}
        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent2-500 px-5 py-3 text-sm font-bold text-ink shadow-[0_0_0_1px_rgba(0,232,122,0.4),0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-all hover:bg-accent2-400 active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            Yuborilmoqda...
          </>
        ) : (
          <>
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Xabar yuborish
          </>
        )}
      </button>

      {error && (
        <p
          role="alert"
          className="max-w-xs rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Map an `ApiClientError` raised by `/dm/threads` into a friendly Uzbek
 * message. The API exposes a stable `error.code` envelope; we cover the
 * cases the rate-limit / DM service can emit and fall back to a generic
 * message when the code is missing.
 */
function translateDmError(err: unknown): string {
  if (err instanceof ApiClientError) {
    const code = extractErrorCode(err.details);
    if (code === 'DM_RATE_LIMITED' || err.statusCode === 429) {
      return "Bir kunda yuboriladigan xabarlar chegarasiga yetdingiz. Iltimos, bir necha soatdan keyin qayta urinib ko'ring.";
    }
    if (code === 'DM_FORBIDDEN_PEER' || err.statusCode === 403) {
      return 'Ushbu ustozga xabar yuborishga ruxsat yo\u2018q.';
    }
    if (err.statusCode === 401) {
      return 'Xabar yuborish uchun avval tizimga kiring.';
    }
    return err.message;
  }
  return "Xabar yuborishda xatolik. Iltimos, qayta urinib ko'ring.";
}
