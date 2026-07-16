'use client';

import { ConversationList } from '../../../../../../components/messages/conversation-list';
import { GroupThread } from '../../../../../../components/messages/group-thread';

interface GroupPageProps {
  params: { locale: string; id: string };
}

export default function GroupChatPage({ params: { locale, id } }: GroupPageProps) {
  return (
    <div className="flex h-full flex-col lg:flex-row bg-canvas rounded-[2.5rem] border border-rim overflow-hidden shadow-soft">
      <div className="hidden lg:flex">
        <ConversationList locale={locale} activeThreadId={null} />
      </div>
      <GroupThread locale={locale} groupId={id} />
    </div>
  );
}
