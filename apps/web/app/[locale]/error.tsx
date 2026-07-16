'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

import { ErrorState } from '../../components/states/error-state';

/**
 * Route-segment error boundary (Next.js App Router convention).
 *
 * This is the boundary that actually fires for the overwhelming majority
 * of real crashes, since nearly every route lives under `[locale]`. Unlike
 * `app/global-error.tsx` (last-resort, no `<html>`/design-system access),
 * this one renders below the (working) root layout, so it can safely reuse
 * `ErrorState` for visual consistency with how errors are already shown
 * elsewhere in the app (empty/error states on discovery pages, etc).
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <ErrorState
        icon={<AlertTriangle className="h-8 w-8" />}
        title="Nimadir noto'g'ri ketdi"
        message="Sahifani ko'rsatishda kutilmagan xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
        retryLabel="Qayta urinish"
        onRetry={() => reset()}
        className="w-full max-w-md"
      />
    </div>
  );
}
