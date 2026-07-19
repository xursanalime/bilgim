import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../lib/auth-server';
import { AiChatPage } from '../../../../components/ai/ai-chat-page';

interface Props {
  params: { locale: string };
}

export default function AiChatRoute({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });
  return <AiChatPage locale={locale} />;
}

export const metadata = {
  title: 'BilgimAI — AI Yordamchi',
};
