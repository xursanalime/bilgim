import { unstable_setRequestLocale } from 'next-intl/server';

import { requireAuth } from '../../../../lib/auth-server';
import { BilgimAiTutor } from '../../../../components/ai/bilgim-ai-tutor';

interface Props {
  params: { locale: string };
}

/**
 * Dedicated full-screen BilgimAI tutor surface (Req 11.1–11.5). Shares the
 * same {@link BilgimAiTutor} implementation used by the floating launcher,
 * so the intent selection, hint-only framing, rate-limit display and
 * streaming reveal stay consistent across entry points.
 */
export default function BilgimAiRoute({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  return (
    <BilgimAiTutor
      locale={locale}
      role={user.role as 'STUDENT' | 'TEACHER' | 'ADMIN'}
      variant="page"
      className="mx-auto h-full w-full max-w-3xl border-x border-rim"
    />
  );
}

export const metadata = {
  title: 'BilgimAI — Repetitor',
};
