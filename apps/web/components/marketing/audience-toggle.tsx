'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AudienceToggleProps {
  locale: string;
}

/**
 * AudienceToggle — pill-shaped toggle that switches between
 * teacher landing (/) and student landing (/talabalar).
 */
export function AudienceToggle({ locale }: AudienceToggleProps) {
  const pathname = usePathname();
  const isStudentPage = pathname.includes('/talabalar');

  return (
    <div className="inline-flex items-center rounded-full border border-forest-800/15 bg-pomelo-50/80 p-1 backdrop-blur-sm shadow-sm">
      <Link
        href={`/${locale}`}
        className={`relative rounded-full px-4 py-1.5 text-xs font-bold transition-all sm:text-sm ${
          !isStudentPage
            ? 'bg-forest-800 text-pomelo-100 shadow-md'
            : 'text-forest-700/70 hover:text-forest-800'
        }`}
      >
        O&apos;qituvchilar uchun
      </Link>
      <Link
        href={`/${locale}/talabalar`}
        className={`relative rounded-full px-4 py-1.5 text-xs font-bold transition-all sm:text-sm ${
          isStudentPage
            ? 'bg-forest-800 text-pomelo-100 shadow-md'
            : 'text-forest-700/70 hover:text-forest-800'
        }`}
      >
        Talabalar uchun
      </Link>
    </div>
  );
}
