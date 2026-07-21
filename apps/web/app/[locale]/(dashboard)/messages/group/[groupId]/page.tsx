import { unstable_setRequestLocale } from 'next-intl/server';

import { GroupChatView } from '../../../../../../components/messages/group-chat-view';

interface GroupThreadPageProps {
  params: { locale: string; groupId: string };
}

/**
 * `/[locale]/messages/group/[groupId]` — Telegram-style group chat view,
 * auto-provisioned 1:1 with a course `Group` (cohort). Sibling to
 * `/[locale]/messages/[roomId]` (1:1 DMs) — Next.js resolves the literal
 * `group` segment ahead of the `[roomId]` dynamic segment, so both
 * routes coexist under `messages/`.
 */
export default function GroupThreadPage({
  params: { locale, groupId },
}: GroupThreadPageProps) {
  unstable_setRequestLocale(locale);

  return <GroupChatView locale={locale} groupId={groupId} />;
}
