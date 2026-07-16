import Link from 'next/link';
import { ShieldX, ArrowLeft } from 'lucide-react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { requireAuth } from '../../../../lib/auth-server';

interface NotAuthorizedPageProps {
  params: { locale: string };
}

/**
 * Role-guard "not authorized" state (Req 16.5). Role-protected pages
 * (`requireAuth({ roles })` / `requireRole`) redirect here when an
 * authenticated user lacks the required role, rather than silently bouncing
 * them somewhere unexpected. The page sends the user back to a home surface
 * appropriate to their actual role.
 */
export default function NotAuthorizedPage({
  params: { locale },
}: NotAuthorizedPageProps) {
  unstable_setRequestLocale(locale);
  // Authenticated users only — unauthenticated requests go to login.
  const user = requireAuth({ locale });
  const homeHref =
    user.role === 'ADMIN' ? `/${locale}/admin` : `/${locale}/dashboard`;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] border border-red/15 bg-red/5 text-red">
        <ShieldX className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-6 font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
        Ruxsat yoʻq
      </h1>
      <p className="mt-3 max-w-sm text-sm text-ink-soft">
        Bu sahifaga kirish uchun ruxsatingiz yetarli emas. Agar bu xato deb
        oʻylasangiz, administrator bilan bogʻlaning.
      </p>
      <Link
        href={homeHref}
        className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-blue px-7 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Bosh sahifaga qaytish
      </Link>
    </div>
  );
}
