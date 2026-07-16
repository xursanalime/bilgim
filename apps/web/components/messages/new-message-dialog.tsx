'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Search, 
  X, 
  User, 
  MessageCircle, 
  ArrowRight,
  Loader2,
  AlertCircle,
  GraduationCap
} from 'lucide-react';

import { dmApi, describeDmError } from '../../lib/api/dm';
import { usersApi, type UserSearchResult } from '../../lib/api/users';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

interface NewMessageDialogProps {
  locale: string;
  /** Render-prop trigger so callers can place the button anywhere. */
  trigger?: (open: () => void) => React.ReactNode;
}

export function NewMessageDialog({ locale, trigger }: NewMessageDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeDialog = useCallback(() => setOpen(false), []);

  // Custom (non-Radix) dialog: trap focus within the overlay, close on Esc, and
  // restore focus to the trigger on close (Req 7.1–7.3).
  useFocusTrap(dialogRef, { active: open, onClose: closeDialog });

  // Debounce — keep the discovery API quiet on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(rawQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [rawQuery]);

  // Focus the input the first time we open (after the focus trap runs, so the
  // search field — not the close button — receives initial focus).
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const usersQuery = useQuery({
    queryKey: ['users', 'search', debounced],
    queryFn: () => usersApi.searchUsers(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
  });

  const openThread = useMutation({
    mutationFn: (recipientId: string) => dmApi.openThread(recipientId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
      setOpen(false);
      setRawQuery('');
      setDebounced('');
      router.push(`/${locale}/messages/${result.thread.id}`);
    },
  });

  const users = usersQuery.data ?? [];
  
  const errorText = openThread.isError
    ? describeDmError(openThread.error)
    : null;

  const showEmpty =
    !usersQuery.isLoading && !usersQuery.isError && users.length === 0 && debounced.length >= 2;

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-xs font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
          Yangi suhbat
        </button>
      )}

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Yangi suhbat boshlash"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-24 backdrop-blur-md animate-in fade-in duration-300"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-2xl animate-in zoom-in-95 duration-300">
            <header className="relative flex items-center justify-between gap-3 border-b border-rim px-6 py-6 bg-tint/30">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue/5 text-blue border border-blue/10">
                  <MessageCircle className="h-5.5 w-5.5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
                    Yangi suhbat
                  </h2>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    Foydalanuvchini tanlang
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Yopish"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-faint transition-all hover:bg-white hover:text-ink-strong active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="px-6 py-5">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-faint" />
                <input
                  ref={inputRef}
                  type="search"
                  value={rawQuery}
                  onChange={(e) => setRawQuery(e.target.value)}
                  placeholder="Ism yoki username orqali qidirish..."
                  className="w-full rounded-2xl border border-rim bg-white py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:ring-4 focus:ring-blue/5"
                />
              </div>

              {errorText ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red/20 bg-red-tint px-4 py-3 text-xs font-bold text-red">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {errorText}
                </div>
              ) : null}
            </div>

            <div className="max-h-[360px] overflow-y-auto px-3 pb-6">
              {usersQuery.isLoading ? (
                <div className="space-y-2 px-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-2xl bg-tint" />
                  ))}
                </div>
              ) : usersQuery.isError ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="mb-2 h-8 w-8 text-red/20" />
                  <p className="px-5 text-sm font-medium text-red/60">
                    {usersQuery.error instanceof ApiClientError
                      ? usersQuery.error.message
                      : "Qidiruvda xatolik yuz berdi."}
                  </p>
                </div>
              ) : showEmpty ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-ink-faint">
                    <Search className="h-6 w-6 opacity-30" />
                  </div>
                  <p className="max-w-xs text-sm font-medium text-ink-faint">
                    {debounced
                      ? `«${debounced}» bo‘yicha foydalanuvchi topilmadi.`
                      : 'Boshlash uchun kamida 2 ta belgi yozing.'}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {users.map((u: UserSearchResult) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => openThread.mutate(u.id)}
                        disabled={openThread.isPending}
                        className="group flex w-full items-center gap-4 rounded-[1.5rem] p-3 text-left transition-all hover:bg-blue/5 disabled:opacity-60"
                      >
                        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-tint border border-rim group-hover:border-blue/20 transition-colors">
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt={u.fullName} className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-6 w-6 text-ink-faint" />
                          )}
                          <div className="absolute inset-0 bg-blue/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-display text-sm font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                              {u.fullName}
                            </p>
                            <ArrowRight className="h-3.5 w-3.5 text-blue opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                          </div>
                          
                          <p className="truncate text-xs font-medium text-ink-faint">
                            @{u.username}
                          </p>
                          
                          <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-blue bg-blue/5 w-fit px-2 py-0.5 rounded-full border border-blue/10">
                            {u.role === 'TEACHER' ? "O'qituvchi" : u.role === 'STUDENT' ? 'Talaba' : u.role}
                          </div>
                        </div>
                        
                        {openThread.isPending && openThread.variables === u.id && (
                          <Loader2 className="h-5 w-5 animate-spin text-blue" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
