'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, X, Search, Check, Loader2, AlertCircle } from 'lucide-react';

import { groupsApi } from '../../lib/api/groups';
import { usersApi, type UserSearchResult } from '../../lib/api/users';
import { ApiClientError } from '../../lib/api-client';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';
import { cn } from '../../lib/utils';

interface NewGroupDialogProps {
  locale: string;
  trigger?: (open: () => void) => React.ReactNode;
}

export function NewGroupDialog({ locale, trigger }: NewGroupDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTitle('');
    setRawQuery('');
    setDebounced('');
    setSelected([]);
  }, []);

  useFocusTrap(dialogRef, { active: open, onClose: close });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(rawQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const usersQuery = useQuery({
    queryKey: ['users', 'search', debounced],
    queryFn: () => usersApi.searchUsers(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      groupsApi.create(title.trim(), selected.map((u) => u.id)),
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: ['dm', 'groups'] });
      close();
      router.push(`/${locale}/messages/group/${group.id}`);
    },
  });

  const toggleUser = (u: UserSearchResult) => {
    setSelected((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u],
    );
  };

  const results = usersQuery.data ?? [];
  const canCreate = title.trim().length >= 1 && !createMutation.isPending;

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Yangi guruh"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-ink-soft transition-colors hover:bg-blue/10 hover:text-blue"
        >
          <Users className="h-4.5 w-4.5" />
        </button>
      )}

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Yangi guruh"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-24 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-rim bg-canvas shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-rim bg-tint/30 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue/10 text-blue">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
                    Yangi guruh
                  </h2>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    Nom bering va a&apos;zolarni tanlang
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Yopish"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-faint transition-all hover:bg-tint hover:text-ink-strong"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label htmlFor="group-title" className="mb-1.5 block text-sm font-semibold text-ink-strong">
                  Guruh nomi
                </label>
                <input
                  id="group-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Masalan: IELTS Speaking guruhi"
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-medium text-ink-strong outline-none focus:border-blue/40 focus:bg-canvas focus:ring-4 focus:ring-blue/10"
                />
              </div>

              {/* Selected chips */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((u) => (
                    <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-blue/10 py-1 pl-3 pr-1.5 text-xs font-semibold text-blue">
                      {u.fullName}
                      <button type="button" onClick={() => toggleUser(u)} aria-label="Olib tashlash" className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-blue/20">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-faint" />
                <input
                  type="search"
                  value={rawQuery}
                  onChange={(e) => setRawQuery(e.target.value)}
                  placeholder="A'zo qo'shish — ism orqali qidirish..."
                  className="w-full rounded-2xl border border-rim bg-canvas py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none focus:border-blue/30 focus:ring-4 focus:ring-blue/5"
                />
              </div>

              {createMutation.isError && (
                <div className="flex items-center gap-2 rounded-2xl border border-red/20 bg-red-tint px-4 py-3 text-xs font-bold text-red">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {createMutation.error instanceof ApiClientError ? createMutation.error.message : 'Xatolik yuz berdi'}
                </div>
              )}
            </div>

            <div className="max-h-[280px] overflow-y-auto px-3">
              {usersQuery.isLoading ? (
                <div className="space-y-2 px-3 pb-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-2xl bg-tint" />
                  ))}
                </div>
              ) : debounced.length >= 2 && results.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-ink-faint">Foydalanuvchi topilmadi.</p>
              ) : (
                <ul className="space-y-1 pb-3">
                  {results.map((u) => {
                    const isSel = selected.some((s) => s.id === u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => toggleUser(u)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all',
                            isSel ? 'bg-blue/5' : 'hover:bg-tint/60',
                          )}
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rim bg-tint text-ink-faint">
                            {u.avatarUrl ? <img src={u.avatarUrl} alt={u.fullName} className="h-full w-full object-cover" /> : u.fullName.charAt(0)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink-strong">{u.fullName}</span>
                            <span className="block truncate text-xs text-ink-faint">@{u.username || u.id.slice(0, 6)}</span>
                          </span>
                          <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border', isSel ? 'border-blue bg-blue text-white' : 'border-rim text-transparent')}>
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-rim px-6 py-4">
              <span className="text-xs font-medium text-ink-soft">
                {selected.length} a&apos;zo tanlandi
              </span>
              <button
                type="button"
                disabled={!canCreate}
                onClick={() => createMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.97] disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Guruh yaratish
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
