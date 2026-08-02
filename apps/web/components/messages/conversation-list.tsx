'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  Search,
  Plus,
  User,
  Clock,
  AlertCircle,
  MessageCircle,
  MoreVertical,
  Users,
} from 'lucide-react';

import { dmApi, type DmThreadSummary } from '../../lib/api/dm';
import { groupChatApi, type GroupChatSummary } from '../../lib/api/group-chat';
import { ApiClientError } from '../../lib/api-client';
import { NewMessageDialog } from './new-message-dialog';
import { cn } from '../../lib/utils';

type ConversationItem =
  | { kind: 'dm'; id: string; ts: number; thread: DmThreadSummary }
  | { kind: 'group'; id: string; ts: number; group: GroupChatSummary };

interface ConversationListProps {
  locale: string;
  /** Currently selected thread (highlighted in the list). */
  activeThreadId?: string | null;
  /** Extra classes merged onto the root `<aside>` — e.g. to hide it below `lg` once a thread is open on mobile. */
  className?: string;
}

export function ConversationList({
  locale,
  activeThreadId,
  className,
}: ConversationListProps) {
  const [query, setQuery] = useState('');
  // The inbox list has no socket push of its own yet (Phase 1 adds a
  // `user:{userId}` room so a new message anywhere patches this cache
  // directly) — polling is still the primary sync path here, so this
  // interval stays tighter than the per-thread queries above.
  const threadsQuery = useQuery({
    queryKey: ['dm', 'threads'],
    queryFn: () => dmApi.listThreads({ pageSize: 50 }),
    refetchInterval: 30_000,
  });
  const groupsQuery = useQuery({
    queryKey: ['group-chat', 'groups'],
    queryFn: () => groupChatApi.listMyGroups(),
    refetchInterval: 30_000,
  });

  const isLoading = threadsQuery.isLoading || groupsQuery.isLoading;
  const isError = threadsQuery.isError || groupsQuery.isError;
  const loadError =
    threadsQuery.error instanceof ApiClientError
      ? threadsQuery.error
      : groupsQuery.error instanceof ApiClientError
        ? groupsQuery.error
        : null;

  const items: ConversationItem[] = useMemo(() => {
    const dmItems: ConversationItem[] = (threadsQuery.data?.items ?? []).map((thread) => ({
      kind: 'dm',
      id: thread.id,
      ts: Date.parse(thread.lastMessage?.createdAt ?? thread.createdAt),
      thread,
    }));
    const groupItems: ConversationItem[] = (groupsQuery.data ?? []).map((group) => ({
      kind: 'group',
      id: group.groupId,
      ts: Date.parse(group.lastMessage?.createdAt ?? group.createdAt),
      group,
    }));
    return [...dmItems, ...groupItems].sort((a, b) => b.ts - a.ts);
  }, [threadsQuery.data, groupsQuery.data]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack =
        item.kind === 'dm'
          ? [item.thread.peer.fullName, item.thread.peer.username, item.thread.lastMessage?.text ?? '']
          : [item.group.name, item.group.lastMessage?.text ?? ''];
      return haystack.join(' ').toLowerCase().includes(q);
    });
  }, [query, items]);

  return (
    <aside className={cn('flex h-full w-full flex-col border-r border-rim bg-canvas lg:w-80 xl:w-96', className)}>
      <header className="space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue/5 text-blue">
              <MessageCircle className="h-4.5 w-4.5" />
            </div>
            <h1 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
              Suhbatlar
            </h1>
          </div>
          <NewMessageDialog locale={locale} />
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input 
            type="text" 
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Suhbatlarni qidirish..."
            className="w-full rounded-xl border border-rim bg-tint/30 py-2.5 pl-10 pr-4 text-xs outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-tint/50" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-2 h-8 w-8 text-red/40" />
            <p className="px-4 text-xs font-medium text-red/60">
              {loadError ? loadError.message : "Suhbatlarni yuklab bo'lmadi."}
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-blue/5 text-blue/30">
              <MessageSquare className="h-8 w-8" />
            </div>
            <p className="px-8 text-sm font-medium text-ink-faint">
              Hozircha suhbatlar yo&apos;q. Yangi xabar yuborish orqali boshlang.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-tint text-ink-faint">
              <Search className="h-7 w-7 opacity-40" />
            </div>
            <p className="px-8 text-sm font-medium text-ink-faint">
              Bu qidiruv bo&apos;yicha suhbat topilmadi.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredItems.map((item) =>
              item.kind === 'dm' ? (
                <ThreadRow
                  key={`dm-${item.id}`}
                  locale={locale}
                  thread={item.thread}
                  active={item.id === activeThreadId}
                />
              ) : (
                <GroupRow
                  key={`group-${item.id}`}
                  locale={locale}
                  group={item.group}
                  active={item.id === activeThreadId}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ThreadRow({
  locale,
  thread,
  active,
}: {
  locale: string;
  thread: DmThreadSummary;
  active: boolean;
}) {
  const last = thread.lastMessage;
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  
  return (
    <li>
      <Link
        href={`/${locale}/messages/${thread.id}`}
        className={cn(
          "group relative flex items-center gap-4 rounded-[1.5rem] p-4 transition-all duration-300",
          active 
            ? "bg-blue text-white shadow-blue-soft shadow-lg scale-[1.02] z-10" 
            : "hover:bg-tint/50 active:scale-[0.98]"
        )}
      >
        <div className={cn(
          "relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim shadow-sm transition-colors group-hover:border-blue/20",
          active ? "bg-blue/10" : "bg-tint"
        )}>
          {thread.peer.avatarUrl && !avatarLoadError ? (
            <img 
              src={thread.peer.avatarUrl} 
              alt={thread.peer.fullName} 
              className="h-full w-full object-cover"
              onError={() => setAvatarLoadError(true)}
            />
          ) : (
            <span className={cn(
              "font-display text-lg font-bold uppercase",
              active ? "text-white" : "text-blue"
            )}>
              {thread.peer.fullName?.charAt(0) ?? thread.peer.username?.charAt(0) ?? '?'}
            </span>
          )}
          <div className={cn(
            "absolute inset-0 transition-opacity",
            active ? "bg-white/10" : "bg-blue/5 opacity-0 group-hover:opacity-100"
          )} />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              "truncate font-display text-sm font-extrabold",
              active ? "text-white" : "text-ink-strong"
            )}>
              {thread.peer.fullName}
            </span>
            {thread.unreadCount > 0 && !active && (
              <span className="flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-blue px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                {thread.unreadCount}
              </span>
            )}
            {last ? (
              <span className={cn(
                "shrink-0 text-[9px] font-bold uppercase tracking-wider",
                active ? "text-white/60" : "text-ink-faint"
              )}>
                {formatRelative(last.createdAt)}
              </span>
            ) : null}
          </div>
          
          <div className="flex items-center justify-between gap-3">
            <p className={cn(
              "truncate text-xs font-medium",
              active ? "text-white/80" : "text-ink-soft"
            )}>
              {last ? last.text : 'Hali xabar yuborilmagan.'}
            </p>
            
            {!thread.reciprocated && !active && (
              <div className="h-2 w-2 shrink-0 rounded-full bg-blue animate-pulse shadow-sm shadow-blue/30" />
            )}
          </div>
        </div>

        {active && (
          <div className="absolute -left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white/40" />
        )}
      </Link>
    </li>
  );
}

function GroupRow({
  locale,
  group,
  active,
}: {
  locale: string;
  group: GroupChatSummary;
  active: boolean;
}) {
  const last = group.lastMessage;
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const avatarQuery = useQuery({
    queryKey: ['group-chat', 'avatar-url', group.groupId],
    queryFn: () => groupChatApi.getAvatarUrl(group.groupId),
    enabled: group.hasAvatar,
  });
  const avatarUrl = avatarQuery.data?.url ?? null;

  return (
    <li>
      <Link
        href={`/${locale}/messages/group/${group.groupId}`}
        className={cn(
          'group relative flex items-center gap-4 rounded-[1.5rem] p-4 transition-all duration-300',
          active
            ? 'bg-blue text-white shadow-blue-soft shadow-lg scale-[1.02] z-10'
            : 'hover:bg-tint/50 active:scale-[0.98]',
        )}
      >
        <div
          className={cn(
            'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim shadow-sm transition-colors group-hover:border-blue/20',
            active ? 'bg-blue/10' : 'bg-tint',
          )}
        >
          {avatarUrl && !avatarLoadError ? (
            <img
              src={avatarUrl}
              alt={group.name}
              className="h-full w-full object-cover"
              onError={() => setAvatarLoadError(true)}
            />
          ) : (
            <Users className={cn('h-5 w-5', active ? 'text-white' : 'text-blue')} />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate font-display text-sm font-extrabold',
                active ? 'text-white' : 'text-ink-strong',
              )}
            >
              {group.name}
            </span>
            {group.unreadCount > 0 && !active && (
              <span className="flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-blue px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                {group.unreadCount}
              </span>
            )}
            {last ? (
              <span
                className={cn(
                  'shrink-0 text-[9px] font-bold uppercase tracking-wider',
                  active ? 'text-white/60' : 'text-ink-faint',
                )}
              >
                {formatRelative(last.createdAt)}
              </span>
            ) : null}
          </div>

          <p
            className={cn(
              'truncate text-xs font-medium',
              active ? 'text-white/80' : 'text-ink-soft',
            )}
          >
            {last ? last.text : 'Hali xabar yuborilmagan.'}
          </p>
        </div>

        {active && (
          <div className="absolute -left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white/40" />
        )}
      </Link>
    </li>
  );
}

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatRelative(input: string): string {
  try {
    const ms = Date.now() - Date.parse(input);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (ms < minute) return 'hozir';
    if (ms < hour) return `${Math.floor(ms / minute)} daq`;
    if (ms < day) return `${Math.floor(ms / hour)} soat`;
    return `${Math.floor(ms / day)} kun`;
  } catch {
    return '';
  }
}
