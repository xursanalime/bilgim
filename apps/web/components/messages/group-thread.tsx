'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Users, Loader2, Crown } from 'lucide-react';

import { groupsApi, type GroupMessage } from '../../lib/api/groups';
import { getCurrentUser } from '../../lib/auth';
import { cn } from '../../lib/utils';

interface GroupThreadProps {
  locale: string;
  groupId: string;
}

export function GroupThread({ locale, groupId }: GroupThreadProps) {
  const queryClient = useQueryClient();
  const me = useMemo(() => getCurrentUser(), []);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  const groupQuery = useQuery({
    queryKey: ['dm', 'group', groupId],
    queryFn: () => groupsApi.get(groupId),
  });

  const messagesQuery = useQuery({
    queryKey: ['dm', 'group', groupId, 'messages'],
    queryFn: () => groupsApi.listMessages(groupId, { pageSize: 50 }),
    refetchInterval: 5_000,
  });

  // Newest-first from API → show oldest-first.
  const messages = useMemo(
    () => [...(messagesQuery.data?.items ?? [])].reverse(),
    [messagesQuery.data],
  );

  useEffect(() => {
    void groupsApi.markRead(groupId).catch(() => {});
  }, [groupId, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (text: string) => groupsApi.sendMessage(groupId, text),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['dm', 'group', groupId, 'messages'] });
      void queryClient.invalidateQueries({ queryKey: ['dm', 'groups'] });
    },
  });

  const submit = () => {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  const group = groupQuery.data;

  return (
    <section className="flex h-full flex-1 flex-col bg-canvas">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-rim px-5 py-4">
        <Link
          href={`/${locale}/messages`}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint lg:hidden"
          aria-label="Orqaga"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue/10 text-blue">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-extrabold tracking-tight text-ink-strong">
            {group?.title ?? 'Guruh'}
          </h2>
          <button
            type="button"
            onClick={() => setMembersOpen((v) => !v)}
            className="text-xs text-ink-soft hover:text-blue"
          >
            {group?.memberCount ?? 0} a&apos;zo · ko&apos;rish
          </button>
        </div>
      </header>

      {/* Members panel */}
      {membersOpen && group && (
        <div className="border-b border-rim bg-tint/30 px-5 py-3">
          <ul className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-canvas border border-rim px-3 py-1 text-xs font-semibold text-ink-strong">
                {m.role === 'OWNER' && <Crown className="h-3 w-3 text-orange" aria-label="Egasi" />}
                {m.fullName}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messagesQuery.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-ink-faint">
            <Users className="mb-2 h-10 w-10 opacity-30" />
            <p className="text-sm">Hali xabar yo&apos;q. Birinchi bo&apos;lib yozing!</p>
          </div>
        ) : (
          messages.map((msg) => <Bubble key={msg.id} msg={msg} mine={msg.authorId === me?.sub} />)
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-rim px-5 py-4">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Xabar yozing..."
            className="max-h-32 flex-1 resize-none rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong outline-none focus:border-blue/40 focus:bg-canvas focus:ring-4 focus:ring-blue/10"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || sendMutation.isPending}
            aria-label="Yuborish"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-90 disabled:opacity-50"
          >
            {sendMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </section>
  );
}

function Bubble({ msg, mine }: { msg: GroupMessage; mine: boolean }) {
  return (
    <div className={cn('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
      {!mine && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-rim bg-tint text-xs font-bold text-ink-soft">
          {msg.author?.avatarUrl ? (
            <img src={msg.author.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (msg.author?.fullName ?? '?').charAt(0)
          )}
        </span>
      )}
      <div className={cn('max-w-[75%] rounded-2xl px-4 py-2.5 text-sm', mine ? 'rounded-tr-sm bg-blue text-white' : 'rounded-tl-sm border border-rim bg-canvas text-ink-soft')}>
        {!mine && (
          <span className="mb-0.5 block text-[11px] font-bold text-blue">{msg.author?.fullName ?? 'Foydalanuvchi'}</span>
        )}
        <span className="whitespace-pre-wrap break-words">{msg.text}</span>
      </div>
    </div>
  );
}
