import { unstable_setRequestLocale } from 'next-intl/server';

import { ConversationList } from '../../../../../components/messages/conversation-list';
import { MessageThread } from '../../../../../components/messages/message-thread';

interface ThreadPageProps {
  params: { locale: string; roomId: string };
  searchParams?: { lessonId?: string };
}

/**
 * `/[locale]/messages/[roomId]` — direct conversation view.
 *
 * `searchParams.lessonId` lets a lesson chat link share the same
 * surface — when present we render the room as a group/lesson chat
 * (Task 25.6, group chat note).
 */
export default function MessageThreadPage({
  params: { locale, roomId },
  searchParams,
}: ThreadPageProps) {
  unstable_setRequestLocale(locale);
  const lessonId = searchParams?.lessonId ?? null;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <ConversationList
        locale={locale}
        activeThreadId={roomId}
        className="hidden lg:flex"
      />
      <MessageThread threadId={roomId} lessonId={lessonId} />
    </div>
  );
}
