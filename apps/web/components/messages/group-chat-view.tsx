'use client';

import { useState } from 'react';

import { ConversationList } from './conversation-list';
import { GroupChatThread } from './group-chat-thread';
import { GroupMembersPanel } from './group-members-panel';

interface GroupChatViewProps {
  locale: string;
  groupId: string;
}

/**
 * Composes the group chat surface: conversation list (DMs + groups) on
 * the left, the group thread in the middle, and a slide-over members
 * panel toggled from the thread header — mirrors how `[roomId]/page.tsx`
 * composes `ConversationList` + `MessageThread` for 1:1 DMs.
 */
export function GroupChatView({ locale, groupId }: GroupChatViewProps) {
  const [membersOpen, setMembersOpen] = useState(false);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <ConversationList
        locale={locale}
        activeThreadId={groupId}
        className="hidden lg:flex"
      />
      <GroupChatThread groupId={groupId} onOpenMembers={() => setMembersOpen(true)} />
      {membersOpen && (
        <GroupMembersPanel
          locale={locale}
          groupId={groupId}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  );
}
