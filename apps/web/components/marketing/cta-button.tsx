'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Smart "Boshlash" button — points to /register and adds ?role=student when
 * the user is currently on the student-facing landing page.
 */
export function CtaButton({ locale }: { locale: string }) {
  const pathname = usePathname();
  const path = pathname.replace(new RegExp(`^/${locale}`), '') || '/';
  const isStudentRoute = path.startsWith('/talabalar-uchun');

  const href = isStudentRoute
    ? `/${locale}/register?role=student`
    : `/${locale}/register?role=teacher`;

  return (
    <Link
      href={href}
      className="rounded-full bg-accent2-500 px-5 py-2 text-sm font-bold text-ink shadow-[0_0_20px_rgba(0,232,122,0.4)] transition-all hover:bg-accent2-400 hover:shadow-[0_0_28px_rgba(0,232,122,0.6)] active:scale-[0.98]"
    >
      Boshlash
    </Link>
  );
}
