'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Share2, Loader2, CheckCircle2, Link as LinkIcon,
  Trash2, ChevronDown, ChevronUp, Copy, X, Plus,
} from 'lucide-react';
import { enrollmentApi, type CreatedInvite } from '../../lib/api/enrollment';
import { cn } from '../../lib/utils';

interface InviteLinkButtonProps {
  groupId: string;
}

function timeLeft(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'Muddatsiz';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Muddati tugagan';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} kun qoldi`;
  return `${hours} soat qoldi`;
}

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-bold text-blue hover:bg-blue/8 transition-all active:scale-95"
      title="Havolani nusxalash"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? <span className="text-teal">Nusxalandi</span> : 'Nusxalash'}
    </button>
  );
}

export function InviteLinkButton({ groupId }: InviteLinkButtonProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // List existing invite links
  const linksQuery = useQuery({
    queryKey: ['enrollment', 'invite-links', groupId],
    queryFn: () => enrollmentApi.listInviteLinks(groupId),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: () => enrollmentApi.createInviteLink({ groupId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', 'invite-links', groupId] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => enrollmentApi.revokeInviteLink(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', 'invite-links', groupId] });
    },
  });

  const links = linksQuery.data ?? [];

  // Close the popover on Esc while it is open (custom popover; Req 7.2).
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/60 bg-white/80 px-5 text-sm font-bold text-ink-strong shadow-sm backdrop-blur-md transition-all hover:bg-white hover:scale-[1.02] active:scale-[0.98]"
      >
        <Share2 className="h-4 w-4 text-blue" />
        Taklif havolasi
        {open ? <ChevronUp className="h-3.5 w-3.5 text-ink-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 z-50 w-[380px] rounded-3xl border border-white/60 bg-white/95 shadow-[0_20px_50px_rgba(0,0,0,0.15)] backdrop-blur-xl overflow-hidden animate-in fade-in-50 slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-rim/50">
            <div>
              <p className="text-sm font-black text-ink-strong">Taklif havolalari</p>
              <p className="text-[11px] text-ink-faint">O'quvchilar shu havola orqali qo'shiladi</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-ink-soft hover:bg-black/5 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-3 max-h-60 overflow-y-auto">
            {linksQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
              </div>
            ) : links.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <LinkIcon className="h-8 w-8 text-ink-faint/30 mb-2 animate-pulse" />
                <p className="text-xs font-semibold text-ink-faint">Hali taklif havola yaratilmagan</p>
              </div>
            ) : (
              links.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/50 px-4 py-3 shadow-sm transition-all hover:bg-white/80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono font-bold text-blue truncate">{link.url}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-md",
                        link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()
                          ? "bg-red/10 text-red"
                          : "bg-teal/10 text-teal"
                      )}>
                        {timeLeft(link.expiresAt)}
                      </span>
                      {link.usesLimit != null && (
                        <span className="text-[10px] font-medium text-ink-soft bg-black/5 px-2 py-0.5 rounded-md">
                          {link.usesLimit} ta limit
                        </span>
                      )}
                    </div>
                  </div>
                  <CopyButton url={link.url} />
                  <button
                    onClick={() => revokeMut.mutate(link.id)}
                    disabled={revokeMut.isPending}
                    className="h-8 w-8 flex items-center justify-center rounded-xl text-ink-faint hover:text-red hover:bg-red/10 transition-all disabled:opacity-40"
                    title="Havolani bekor qilish"
                  >
                    {revokeMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-red" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-rim/50 px-5 py-4 bg-white/40">
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue to-purple py-3 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.4)] hover:shadow-[0_8px_25px_-6px_rgba(0,113,227,0.6)] hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {createMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Yangi havola yaratish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
