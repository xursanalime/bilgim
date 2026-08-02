'use client';

import {
  useCallback, useEffect, useRef, useState, useMemo,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus, Sparkles, Send, Loader2, Trash2, Edit2,
  MessageSquare, User, Paperclip,
  MoreHorizontal, FileText, Image, X, Eraser,
} from 'lucide-react';
import {
  aiConversationsApi,
  type AiConversation,
  type AiMessage,
  type AiMessageAttachment,
} from '../../lib/api/ai-conversations';
import { cn } from '../../lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Hozirgina';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} daqiqa oldin`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} soat oldin`;
  return new Date(date).toLocaleDateString('uz-UZ');
}

async function extractText(file: File): Promise<string> {
  if (file.type.startsWith('text/') || /\.(txt|md|csv)$/.test(file.name)) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = (e) => res(String(e.target?.result ?? ''));
      r.onerror = () => res('');
      r.readAsText(file);
    });
  }
  return '';
}

// ── Message ───────────────────────────────────────────────────────────

function Message({ msg }: { msg: AiMessage }) {
  const isUser = msg.role === 'user';
  const files = (msg.attachments ?? []) as AiMessageAttachment[];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Avatar */}
      <div className={cn(
        'h-8 w-8 shrink-0 rounded-2xl flex items-center justify-center mt-1 shadow-sm',
        isUser
          ? 'bg-blue shadow-blue/25'
          : 'bg-gradient-to-br from-purple to-blue shadow-blue/20',
      )}>
        {isUser
          ? <User className="h-3.5 w-3.5 text-white" />
          : <Sparkles className="h-3.5 w-3.5 text-white" />
        }
      </div>

      <div className={cn('flex flex-col gap-1.5 max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-xl bg-tint border border-rim px-2.5 py-1.5 text-[11px] font-medium text-ink-soft">
                {f.type?.startsWith('image/') ? <Image className="h-3 w-3 text-blue" /> : <FileText className="h-3 w-3 text-blue" />}
                <span className="max-w-[120px] truncate">{f.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-none bg-blue text-white'
            : 'rounded-tl-none bg-white border border-rim/80 text-ink-strong shadow-[0_1px_4px_rgba(0,0,0,0.06)]',
        )}>
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>

        <span className="text-[10px] text-ink-faint px-1">{timeAgo(msg.createdAt)}</span>
      </div>
    </motion.div>
  );
}

// ── Conversation item ─────────────────────────────────────────────────

function ConvItem({
  conv, isActive, onSelect, onRename, onDelete,
}: {
  conv: AiConversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (t: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== conv.title) onRename(t);
    setEditing(false);
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer transition-all select-none',
        isActive
          ? 'bg-blue/10 text-blue'
          : 'text-ink-soft hover:bg-tint hover:text-ink-strong',
      )}
    >
      <MessageSquare className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-blue' : 'text-ink-faint')} />

      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none border-b border-blue text-ink-strong"
        />
      ) : (
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{conv.title}</span>
      )}

      {!editing && (
        <div
          ref={menuRef}
          className={cn('shrink-0 opacity-0 group-hover:opacity-100 transition-opacity', (isActive || menu) && 'opacity-100')}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
            className="h-6 w-6 rounded-lg flex items-center justify-center hover:bg-black/8 text-ink-faint hover:text-ink-soft transition-colors"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {menu && (
            <div className="absolute right-2 top-full mt-1 z-50 w-44 rounded-2xl border border-rim bg-white shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(false);
                  setDraft(conv.title);
                  setEditing(true);
                  setTimeout(() => inputRef.current?.focus(), 30);
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-ink-strong hover:bg-tint transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5 text-ink-soft" /> Nomini o'zgartirish
              </button>
              <div className="h-px bg-rim" />
              <button
                onClick={(e) => { e.stopPropagation(); setMenu(false); onDelete(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-red hover:bg-red/5 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> O'chirish
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Starters ──────────────────────────────────────────────────────────

const STARTERS = [
  { icon: '📚', text: "Bu darsni tushuntiring" },
  { icon: '🧮', text: "Matematika misolini hal qiling" },
  { icon: '✍️', text: "Insho yozishga yordam bering" },
  { icon: '📅', text: "O'qish rejasini tuzing" },
  { icon: '🔍', text: "Bu mavzuni soddalashtiring" },
  { icon: '💡', text: "Yangi g'oya taklif qiling" },
];

// ── Main ──────────────────────────────────────────────────────────────

export function AiChatPage({ locale }: { locale: string }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Queries
  const { data: convs = [], isLoading: listLoading } = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: aiConversationsApi.list,
    refetchOnWindowFocus: false,
  });

  const { data: activeConv, isLoading: convLoading } = useQuery({
    queryKey: ['ai-conv', activeId],
    queryFn: () => aiConversationsApi.get(activeId!),
    enabled: !!activeId,
  });

  // Mutations
  const createMut = useMutation({
    mutationFn: (title?: string) => aiConversationsApi.create(title),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      setActiveId(c.id);
      setMsgs([]);
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      aiConversationsApi.rename(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-conversations'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => aiConversationsApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      if (activeId === id) { setActiveId(null); setMsgs([]); }
    },
  });

  const clearMut = useMutation({
    mutationFn: (id: string) => aiConversationsApi.clear(id),
    onSuccess: () => {
      setMsgs([]);
      qc.invalidateQueries({ queryKey: ['ai-conv', activeId] });
    },
  });

  useEffect(() => { if (activeConv) setMsgs(activeConv.messages); }, [activeConv]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, sending]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;

    let cid = activeId;
    if (!cid) {
      const nc = await createMut.mutateAsync(t.slice(0, 60));
      cid = nc.id;
    }

    const attachments: AiMessageAttachment[] = await Promise.all(
      files.map(async (f) => ({ name: f.name, type: f.type, size: f.size, extractedText: await extractText(f) }))
    );

    const opt: AiMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: t,
      attachments: attachments.length ? attachments : null,
      createdAt: new Date().toISOString(),
    };

    setMsgs((p) => [...p, opt]);
    setInput('');
    setFiles([]);
    setSending(true);
    if (taRef.current) { taRef.current.style.height = 'auto'; }

    try {
      const res = await aiConversationsApi.sendMessage(cid, t, attachments.length ? attachments : undefined, 'uz');
      setMsgs((p) => [
        ...p.filter((m) => !m.id.startsWith('opt-')),
        { ...opt, id: `u-${Date.now()}` },
        res.message,
      ]);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      qc.invalidateQueries({ queryKey: ['ai-conv', cid] });
    } catch {
      setMsgs((p) => [...p.filter((m) => !m.id.startsWith('opt-')), {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: "Kechirasiz, xatolik yuz berdi. Qayta urinib ko'ring.",
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, activeId, files, createMut, qc]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const grouped = useMemo(() => {
    const now = Date.now();
    const today: AiConversation[] = [], week: AiConversation[] = [], older: AiConversation[] = [];
    for (const c of convs) {
      const d = now - new Date(c.updatedAt).getTime();
      if (d < 86_400_000) today.push(c);
      else if (d < 7 * 86_400_000) week.push(c);
      else older.push(c);
    }
    return { today, week, older };
  }, [convs]);

  const activeTitle = convs.find((c) => c.id === activeId)?.title;

  return (
    <div className="flex h-full">

      {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
      <aside className="w-60 shrink-0 flex flex-col h-full border-r border-rim bg-white overflow-hidden">

        {/* Logo */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple to-blue flex items-center justify-center shadow-md shadow-blue/25">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-ink-strong leading-none">BilgimAI</p>
              <p className="text-[10px] font-bold text-ink-faint mt-0.5">Yordamchi</p>
            </div>
          </div>

          <button
            onClick={() => createMut.mutate(undefined)}
            disabled={createMut.isPending}
            className="w-full flex items-center gap-2 rounded-xl bg-blue px-3.5 py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(0,113,227,0.5)] transition-all hover:bg-blue/90 active:scale-[0.97] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Yangi suhbat
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-hide space-y-3">
          {listLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
            </div>
          ) : convs.length === 0 ? (
            <div className="text-center px-4 py-10">
              <div className="h-10 w-10 rounded-2xl bg-tint flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="h-5 w-5 text-ink-faint" />
              </div>
              <p className="text-xs font-bold text-ink-soft">Hali suhbat yo'q</p>
              <p className="text-[11px] text-ink-faint mt-1">Yangi suhbat boshlang</p>
            </div>
          ) : (
            <>
              {grouped.today.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 mb-1">Bugun</p>
                  {grouped.today.map((c) => (
                    <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                      onSelect={() => { setActiveId(c.id); setMsgs([]); }}
                      onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                      onDelete={() => setDelConfirm(c.id)}
                    />
                  ))}
                </div>
              )}
              {grouped.week.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 mb-1">Bu hafta</p>
                  {grouped.week.map((c) => (
                    <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                      onSelect={() => { setActiveId(c.id); setMsgs([]); }}
                      onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                      onDelete={() => setDelConfirm(c.id)}
                    />
                  ))}
                </div>
              )}
              {grouped.older.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 mb-1">Avvalgi</p>
                  {grouped.older.map((c) => (
                    <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                      onSelect={() => { setActiveId(c.id); setMsgs([]); }}
                      onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                      onDelete={() => setDelConfirm(c.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ══ MAIN CHAT AREA ═══════════════════════════════════════ */}
      <div className="flex flex-1 flex-col h-full min-w-0 bg-[#f8f8fc]">

        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-rim bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple to-blue flex items-center justify-center shadow-sm shadow-blue/20">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-ink-strong leading-none">{activeTitle ?? 'BilgimAI'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" />
                <span className="text-[10px] font-bold text-ink-faint uppercase tracking-widest">Faol</span>
              </div>
            </div>
          </div>

          {activeId && (
            <div className="flex gap-1">
              <button
                onClick={() => clearMut.mutate(activeId)}
                disabled={clearMut.isPending}
                title="Suhbatni tozalash"
                className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-ink-soft hover:bg-tint transition-all"
              >
                <Eraser className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDelConfirm(activeId)}
                title="Suhbatni o'chirish"
                className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-red hover:bg-red/8 transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {!activeId ? (
            /* Welcome screen */
            <div className="flex flex-col items-center justify-center h-full px-8 py-10 text-center">
              <div className="relative mb-8">
                <div className="h-24 w-24 rounded-[2rem] bg-gradient-to-br from-purple to-blue flex items-center justify-center shadow-[0_20px_60px_-10px_rgba(0,113,227,0.5)]">
                  <Sparkles className="h-12 w-12 text-white" />
                </div>
                <div className="absolute -bottom-2 -right-2 h-8 w-8 rounded-xl bg-teal/10 border-2 border-white flex items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full bg-teal animate-pulse" />
                </div>
              </div>

              <h2 className="text-3xl font-black text-ink-strong tracking-tight mb-3">
                BilgimAI bilan gaplashing
              </h2>
              <p className="text-base text-ink-soft max-w-md leading-relaxed mb-10">
                O'qish, dars, topshiriq yoki har qanday savol bo'yicha yordam so'rang.
                Fayllarni ham biriktirish mumkin.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl w-full">
                {STARTERS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => { setInput(s.text); taRef.current?.focus(); }}
                    className="group flex items-start gap-3 rounded-2xl border border-rim bg-white px-4 py-4 text-left hover:border-blue/25 hover:bg-blue/3 hover:shadow-sm transition-all active:scale-[0.98]"
                  >
                    <span className="text-xl mt-0.5 shrink-0">{s.icon}</span>
                    <span className="text-sm font-semibold text-ink-soft group-hover:text-ink-strong transition-colors leading-snug">
                      {s.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
              {convLoading && msgs.length === 0 ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
                </div>
              ) : (
                msgs.map((m) => <Message key={m.id} msg={m} />)
              )}

              {sending && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-purple to-blue flex items-center justify-center shadow-sm shadow-blue/20 mt-1">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl rounded-tl-none bg-white border border-rim/80 px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-2 w-2 rounded-full bg-blue/40 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 px-6 pb-5 pt-3 bg-[#f8f8fc]">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 max-w-3xl mx-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-xl bg-white border border-rim px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm">
                  {f.type.startsWith('image/') ? <Image className="h-3 w-3 text-blue" /> : <FileText className="h-3 w-3 text-blue" />}
                  <span className="max-w-[100px] truncate">{f.name}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-0.5 text-ink-faint hover:text-red transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-2xl border border-rim bg-white px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-blue/30 focus-within:shadow-[0_2px_20px_rgba(0,113,227,0.1)] transition-all">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="shrink-0 h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-blue hover:bg-blue/8 transition-all"
                title="Fayl biriktirish"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp"
                onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }}
                className="hidden"
              />

              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
                }}
                onKeyDown={handleKey}
                placeholder="Savolingizni yozing...  (Enter = yuborish, Shift+Enter = yangi qator)"
                rows={1}
                className="flex-1 min-w-0 resize-none bg-transparent text-sm text-ink-strong placeholder-ink-faint outline-none leading-relaxed"
                style={{ maxHeight: 150 }}
              />

              <button
                onClick={() => send(input)}
                disabled={!input.trim() || sending}
                className="shrink-0 h-9 w-9 rounded-xl bg-blue flex items-center justify-center text-white shadow-sm shadow-blue/25 transition-all hover:bg-blue/90 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-center text-[10px] text-ink-faint mt-2 font-medium">
              BilgimAI xato qilishi mumkin. Muhim ma'lumotlarni tekshirib ko'ring.
            </p>
          </div>
        </div>
      </div>

      {/* ══ DELETE DIALOG ════════════════════════════════════════ */}
      <AnimatePresence>
        {delConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-tint-strong/20 backdrop-blur-sm p-4"
            onClick={() => setDelConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-[2.5rem] border border-rim bg-white p-8 shadow-2xl"
            >
              <div className="h-14 w-14 rounded-2xl bg-red/8 border border-red/15 flex items-center justify-center mx-auto mb-5">
                <Trash2 className="h-7 w-7 text-red" />
              </div>
              <h3 className="text-lg font-black text-ink-strong text-center mb-2">Suhbatni o'chirish</h3>
              <p className="text-sm text-ink-soft text-center leading-relaxed mb-6">
                Bu suhbat va barcha xabarlar o'chib ketadi.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDelConfirm(null)}
                  className="flex-1 rounded-2xl border border-rim py-3 text-sm font-black text-ink-soft hover:bg-tint transition-all"
                >
                  Bekor
                </button>
                <button
                  onClick={() => { if (delConfirm) deleteMut.mutate(delConfirm); setDelConfirm(null); }}
                  disabled={deleteMut.isPending}
                  className="flex-1 rounded-2xl bg-red py-3 text-sm font-black text-white hover:bg-red/90 transition-all active:scale-95 shadow-sm shadow-red/20"
                >
                  O'chirish
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
