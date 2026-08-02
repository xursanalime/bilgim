import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../lib/auth-server';
import { AiChatPage } from '../../../../components/ai/ai-chat-page';
import { AI_ENABLED } from '../../../../lib/features';

interface Props {
  params: { locale: string };
}

export default function AiChatRoute({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);
  // AI is out of the MVP. Hiding the nav entry is not enough — the route
  // must not be reachable by typing the URL either.
  if (!AI_ENABLED) notFound();
  requireAuth({ locale });
  return <AiChatPage locale={locale} />;
}

export const metadata = {
  title: 'BilgimAI — AI Yordamchi',
};
