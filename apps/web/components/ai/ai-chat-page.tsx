'use client';

import {
  useCallback, useEffect, useRef, useState, useMemo,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus, Sparkles, Send, Loader2, Trash2, Edit2,
  MessageSquare, User, Paperclip, MoreHorizontal,
  FileText, ImageIcon, X, Eraser, Search, Copy,
  Check, RefreshCw, BookOpen, Languages, Lightbulb,
  ChevronRight, Zap, Brain, PenLine, Calendar,
  ArrowUp, Mic, MicOff,
} from 'lucide-react';
import {
  aiConversationsApi,
  type AiConversation,
  type AiMessage,
  type AiMessageAttachment,
} from '../../lib/api/ai-conversations';
import { cn } from '../../lib/utils';
import { getCurrentUser } from '../../lib/auth';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

// ── Helpers ────────────────────────────────────────────────────────────

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Hozirgina';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} daqiqa oldin`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} soat oldin`;
  const d = new Date(date);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
}

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Markdown renderer ──────────────────────────────────────────────────

function MarkdownText({ content }: { content: string }) {
  const renderInline = (text: string): React.ReactNode[] => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
        return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} className="bg-tint text-blue rounded px-1 py-0.5 font-mono text-[0.82em]">{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      elements.push(
        <div key={i} className="my-3 rounded-xl overflow-hidden border border-rim bg-[#1e1e2e]">
          {lang && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-black/20 border-b border-white/5">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{lang}</span>
            </div>
          )}
          <pre className="px-4 py-3 text-xs font-mono text-[#cdd6f4] overflow-x-auto leading-relaxed">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      i++;
      continue;
    }

    // Headers
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^(#+)/)?.[1] ?? '').length;
      const text = line.replace(/^#+\s/, '');
      const cls = level === 1 ? 'text-base font-black mt-3 mb-1' : level === 2 ? 'text-sm font-black mt-2.5 mb-1' : 'text-sm font-bold mt-2 mb-0.5';
      elements.push(<p key={i} className={cls}>{renderInline(text)}</p>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="my-1.5 border-l-[3px] border-blue/40 pl-3 text-ink-soft italic text-[0.92em]">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*•]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={i} className="my-1.5 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue/50 shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ''));
        i++;
        num++;
      }
      elements.push(
        <ol key={i} className="my-1.5 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm">
              <span className="shrink-0 h-5 w-5 rounded-full bg-blue/10 text-blue text-[10px] font-black flex items-center justify-center mt-0.5">{j + 1}</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="my-3 border-rim/60" />);
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
      i++;
      continue;
    }

    // Normal paragraph
    elements.push(
      <p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>
    );
    i++;
  }

  return <>{elements}</>;
}

// ── CopyButton ─────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all h-6 w-6 rounded-lg flex items-center justify-center text-ink-faint hover:text-blue hover:bg-blue/8"
      title="Nusxa olish"
      aria-label="Nusxa olish"
    >
      {copied ? <Check className="h-3 w-3 text-green" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Message ────────────────────────────────────────────────────────────

function Message({
  msg,
  onRegenerate,
  isLast,
  sending,
}: {
  msg: AiMessage;
  onRegenerate?: (() => void) | undefined;
  isLast: boolean;
  sending: boolean;
}) {
  const isUser = msg.role === 'user';
  const files = (msg.attachments ?? []) as AiMessageAttachment[];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn('group flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Avatar */}
      <div className={cn(
        'h-8 w-8 shrink-0 rounded-xl flex items-center justify-center mt-1 shadow-sm',
        isUser
          ? 'bg-blue shadow-blue/20'
          : 'bg-gradient-to-br from-[#af52de] via-[#5e5ce6] to-[#0071e3] shadow-blue/20',
      )}>
        {isUser
          ? <User className="h-3.5 w-3.5 text-white" />
          : <Sparkles className="h-3.5 w-3.5 text-white" />
        }
      </div>

      <div className={cn('flex flex-col gap-1 max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        {/* File attachments */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-0.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-xl bg-tint border border-rim px-2.5 py-1.5">
                {f.type?.startsWith('image/') ? <ImageIcon className="h-3 w-3 text-purple" /> : <FileText className="h-3 w-3 text-blue" />}
                <span className="text-[11px] font-semibold text-ink-soft max-w-[120px] truncate">{f.name}</span>
                {f.size && <span className="text-[10px] text-ink-faint">{formatBytes(f.size)}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Message bubble */}
        <div className={cn(
          'relative rounded-[1.4rem] px-4 py-3',
          isUser
            ? 'rounded-tr-sm bg-blue text-white shadow-sm shadow-blue/15'
            : 'rounded-tl-sm bg-white border border-rim/70 text-ink-strong shadow-[0_1px_6px_rgba(0,0,0,0.05)]',
        )}>
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <MarkdownText content={msg.content} />
          )}
        </div>

        {/* Actions row */}
        <div className={cn('flex items-center gap-1.5 px-1', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px] text-ink-faint font-medium">{formatTime(msg.createdAt)}</span>
          {!isUser && <CopyButton text={msg.content} />}
          {!isUser && isLast && !sending && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="opacity-0 group-hover:opacity-100 transition-all h-6 w-6 rounded-lg flex items-center justify-center text-ink-faint hover:text-blue hover:bg-blue/8 focus-visible:opacity-100"
              title="Qayta javob olish"
              aria-label="Qayta javob olish"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Conversation list item ─────────────────────────────────────────────

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
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const k = (e: KeyboardEvent) => {
      // Esc closes the menu and returns focus to the trigger (Req 7.2, 7.3).
      if (e.key === 'Escape') { setMenu(false); menuBtnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [menu]);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== conv.title) onRename(t);
    setEditing(false);
  };

  const preview = conv.lastMessage?.content?.slice(0, 45);

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        // Row acts as a button via keyboard, but ignore keys originating from
        // nested controls (edit input, menu button) and while inline-editing.
        if (editing || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Suhbat: ${conv.title}`}
      className={cn(
        'group relative flex items-start gap-2.5 rounded-2xl px-3 py-2.5 cursor-pointer transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40',
        isActive
          ? 'bg-blue/8 border border-blue/15'
          : 'border border-transparent hover:bg-tint hover:border-rim/50',
      )}
    >
      <div className={cn(
        'mt-0.5 h-6 w-6 shrink-0 rounded-lg flex items-center justify-center',
        isActive ? 'bg-blue/15' : 'bg-tint/80',
      )}>
        <MessageSquare className={cn('h-3 w-3', isActive ? 'text-blue' : 'text-ink-faint')} />
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue/40 rounded-sm border-b border-blue text-ink-strong pb-0.5"
            aria-label="Suhbat nomini tahrirlash"
          />
        ) : (
          <p className={cn('text-xs font-semibold truncate', isActive ? 'text-blue' : 'text-ink-strong')}>
            {conv.title}
          </p>
        )}
        {preview && !editing && (
          <p className="text-[10px] text-ink-faint truncate mt-0.5 leading-tight">{preview}</p>
        )}
        <p className="text-[10px] text-ink-faint mt-0.5">{timeAgo(conv.updatedAt)}</p>
      </div>

      {!editing && (
        <div ref={menuRef} className={cn('shrink-0 transition-opacity', (isActive || menu) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          <button
            ref={menuBtnRef}
            onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
            aria-label="Suhbat amallari"
            aria-haspopup="menu"
            aria-expanded={menu}
            className="h-6 w-6 rounded-lg flex items-center justify-center hover:bg-tint text-ink-faint transition-colors focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>

          {menu && (
            <div role="menu" aria-label="Suhbat amallari" className="absolute right-2 top-full mt-1 z-50 w-44 rounded-2xl border border-rim bg-white shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden">
              <button
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenu(false); setDraft(conv.title); setEditing(true); setTimeout(() => inputRef.current?.focus(), 30); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-ink-strong hover:bg-tint transition-colors focus-visible:outline-none focus-visible:bg-tint"
              >
                <Edit2 className="h-3.5 w-3.5 text-ink-soft" /> Nomini o&apos;zgartirish
              </button>
              <div className="h-px bg-rim" />
              <button
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMenu(false); onDelete(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red hover:bg-red/5 transition-colors focus-visible:outline-none focus-visible:bg-red/5"
              >
                <Trash2 className="h-3.5 w-3.5" /> O&apos;chirish
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mode definitions ───────────────────────────────────────────────────

const MODES = [
  {
    id: 'general',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    label: 'Umumiy',
    color: 'text-blue bg-blue/10 border-blue/20',
    activeColor: 'bg-blue text-white border-blue shadow-sm shadow-blue/20',
    prefix: '',
    placeholder: 'Savolingizni yozing...  (Enter = yuborish)',
  },
  {
    id: 'explain',
    icon: <BookOpen className="h-3.5 w-3.5" />,
    label: 'Tushuntir',
    color: 'text-purple bg-purple/8 border-purple/15',
    activeColor: 'bg-[#af52de] text-white border-[#af52de] shadow-sm shadow-purple/20',
    prefix: 'Iltimos, quyidagini oddiy va tushunarli tarzda tushuntirib ber: ',
    placeholder: 'Nima tushuntirilsin?',
  },
  {
    id: 'translate',
    icon: <Languages className="h-3.5 w-3.5" />,
    label: 'Tarjima',
    color: 'text-green bg-green/8 border-green/15',
    activeColor: 'bg-green text-white border-green shadow-sm shadow-green/20',
    prefix: "O'zbek tiliga tarjima qil va tushuntir: ",
    placeholder: "Tarjima qilinadigan matnni yozing...",
  },
  {
    id: 'example',
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    label: 'Misol',
    color: 'text-orange bg-orange/8 border-orange/15',
    activeColor: 'bg-orange text-white border-orange shadow-sm shadow-orange/20',
    prefix: 'Quyidagi mavzu bo\'yicha amaliy misollar keltir: ',
    placeholder: 'Qaysi mavzu bo\'yicha misol kerak?',
  },
] as const;

type ModeId = (typeof MODES)[number]['id'];

// ── Starter prompts ────────────────────────────────────────────────────

const STARTERS = [
  {
    icon: Brain, label: 'Tushuntir',
    hint: 'Nima tushuntirilsin? (masalan: "fotosintez")',
    modeId: 'explain' as ModeId,
    color: 'from-[#af52de]/15 to-blue/15 border-blue/15 hover:border-blue/30',
  },
  {
    icon: PenLine, label: 'Yozing',
    hint: 'Qanday matn yozilsin?',
    modeId: 'general' as ModeId,
    color: 'from-orange/10 to-red/10 border-orange/20 hover:border-orange/40',
  },
  {
    icon: Languages, label: 'Tarjima',
    hint: 'Tarjima qilinadigan so\'z yoki gapni yozing',
    modeId: 'translate' as ModeId,
    color: 'from-green/10 to-teal/10 border-green/20 hover:border-green/40',
  },
  {
    icon: Lightbulb, label: 'Misol',
    hint: 'Qaysi mavzu bo\'yicha misol kerak?',
    modeId: 'example' as ModeId,
    color: 'from-yellow-400/10 to-orange/10 border-yellow-400/20 hover:border-yellow-400/40',
  },
  {
    icon: Zap, label: 'Test',
    hint: 'Qaysi mavzu bo\'yicha test tuzilsin?',
    modeId: 'general' as ModeId,
    customPrefix: "Quyidagi mavzu bo'yicha 5 ta test savoli (variantlar bilan) tuz: ",
    color: 'from-blue/10 to-purple/10 border-blue/20 hover:border-blue/40',
  },
  {
    icon: Calendar, label: 'Reja',
    hint: 'Qaysi fan yoki maqsad uchun reja kerak?',
    modeId: 'general' as ModeId,
    customPrefix: "Quyidagi maqsad yoki fan uchun haftalik o'qish rejasi tuz: ",
    color: 'from-teal/10 to-green/10 border-teal/20 hover:border-teal/40',
  },
];

// ── Main component ─────────────────────────────────────────────────────

export function AiChatPage({ locale }: { locale: string }) {
  const qc = useQueryClient();
  const user = getCurrentUser();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeId>('general');
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Starter kartochasi tanlanganda qo'llaniladigan maxsus prefix (foydalanuvchiga ko'rinmaydi)
  const [starterPrefix, setStarterPrefix] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const delDialogRef = useRef<HTMLDivElement>(null);

  // Custom (non-Radix) confirm dialog: trap focus, Esc closes, restore focus
  // to the opener on close (Req 7.1–7.3).
  useFocusTrap(delDialogRef, { active: !!delConfirm, onClose: () => setDelConfirm(null) });

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0]!;

  // ── Queries ──────────────────────────────────────────────────────────

  const { data: convs = [], isLoading: listLoading } = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: aiConversationsApi.list,
    refetchOnWindowFocus: false,
  });

  const { isLoading: convLoading } = useQuery({
    queryKey: ['ai-conv', activeId],
    queryFn: () => aiConversationsApi.get(activeId!),
    enabled: !!activeId,
    onSuccess: (data: { messages: AiMessage[] }) => setMsgs(data.messages),
  } as Parameters<typeof useQuery>[0]);

  // ── Mutations ────────────────────────────────────────────────────────

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
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });

  // ── Auto scroll ──────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length, sending]);

  // ── Grouped + filtered conversations ─────────────────────────────────

  const filtered = useMemo(() =>
    search.trim()
      ? convs.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.lastMessage?.content?.toLowerCase().includes(search.toLowerCase()))
      : convs,
    [convs, search]
  );

  const grouped = useMemo(() => {
    const now = Date.now();
    const today: AiConversation[] = [], week: AiConversation[] = [], older: AiConversation[] = [];
    for (const c of filtered) {
      const d = now - new Date(c.updatedAt).getTime();
      if (d < 86_400_000) today.push(c);
      else if (d < 7 * 86_400_000) week.push(c);
      else older.push(c);
    }
    return { today, week, older };
  }, [filtered]);

  const activeTitle = convs.find((c) => c.id === activeId)?.title;

  // ── Send ─────────────────────────────────────────────────────────────

  const send = useCallback(async (text: string) => {
    const raw = text.trim();
    if (!raw || sending) return;

    // Mode prefix (Tushuntir/Tarjima/Misol) YOKI starter customPrefix — foydalanuvchiga ko'rinmaydi
    const prefix = starterPrefix ?? (activeMode.prefix || '');
    const fullText = prefix ? `${prefix}${raw}` : raw;
    // Starter prefix faqat bir marta ishlatiladi
    setStarterPrefix(null);

    let cid = activeId;
    if (!cid) {
      const nc = await createMut.mutateAsync(raw.slice(0, 60));
      cid = nc.id;
    }

    const attachments: AiMessageAttachment[] = await Promise.all(
      files.map(async (f) => ({
        name: f.name, type: f.type, size: f.size,
        extractedText: await extractText(f),
      }))
    );

    const opt: AiMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: raw,
      attachments: attachments.length ? attachments : null,
      createdAt: new Date().toISOString(),
    };

    setMsgs((p) => [...p, opt]);
    setInput('');
    setFiles([]);
    setSending(true);
    if (taRef.current) { taRef.current.style.height = 'auto'; }

    try {
      const res = await aiConversationsApi.sendMessage(
        cid, fullText,
        attachments.length ? attachments : undefined,
        'uz',
      );
      setMsgs((p) => [
        ...p.filter((m) => !m.id.startsWith('opt-')),
        { ...opt, id: `u-${Date.now()}` },
        res.message,
      ]);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      qc.invalidateQueries({ queryKey: ['ai-conv', cid] });
    } catch {
      setMsgs((p) => [
        ...p.filter((m) => !m.id.startsWith('opt-')),
        { id: `err-${Date.now()}`, role: 'assistant',
          content: "Kechirasiz, xatolik yuz berdi. Qaytadan urinib ko'ring.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, activeId, files, createMut, qc, activeMode, starterPrefix]);

  // Regenerate last AI response
  const regenerate = useCallback(async () => {
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setMsgs((p) => p.filter((m) => m.id !== msgs[msgs.length - 1]?.id));
      await send(lastUser.content);
    }
  }, [msgs, send]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const selectConv = (id: string) => {
    setActiveId(id);
    setMsgs([]);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const charCount = input.length;
  const charLimit = 4000;

  // ═══ RENDER ═══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full overflow-hidden bg-canvas">

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════ */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="shrink-0 flex flex-col h-full border-r border-rim bg-white overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 pt-5 pb-3">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#af52de] via-[#5e5ce6] to-[#0071e3] flex items-center justify-center shadow-md shadow-blue/20">
                  <Sparkles className="h-4.5 w-4.5 text-white" style={{ width: '1.125rem', height: '1.125rem' }} />
                </div>
                <div>
                  <p className="text-sm font-black text-ink-strong">BilgimAI</p>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
                    <span className="text-[10px] font-bold text-green uppercase tracking-widest">Online</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => { createMut.mutate(undefined); if (window.innerWidth < 768) setSidebarOpen(false); }}
                disabled={createMut.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:bg-blue/90 active:scale-[0.97] disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Yangi suhbat
              </button>

              {/* Search */}
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Suhbatlarni qidirish..."
                  className="w-full rounded-xl bg-tint/80 border border-rim/60 pl-8 pr-3 py-2 text-xs font-medium text-ink-strong placeholder-ink-faint outline-none focus:border-blue/30 focus:bg-white transition-all"
                />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="Qidiruvni tozalash" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 rounded">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Conversations */}
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5 scrollbar-hide">
              {listLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center px-4 py-10">
                  <div className="h-10 w-10 rounded-2xl bg-tint flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="h-5 w-5 text-ink-faint" />
                  </div>
                  <p className="text-xs font-bold text-ink-soft">
                    {search ? 'Natija topilmadi' : "Hali suhbat yo'q"}
                  </p>
                  {!search && <p className="text-[11px] text-ink-faint mt-1">Yangi suhbat boshlang</p>}
                </div>
              ) : (
                <>
                  {grouped.today.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 py-1.5">Bugun</p>
                      {grouped.today.map((c) => (
                        <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                          onSelect={() => selectConv(c.id)}
                          onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                          onDelete={() => setDelConfirm(c.id)}
                        />
                      ))}
                    </div>
                  )}
                  {grouped.week.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 py-1.5">Bu hafta</p>
                      {grouped.week.map((c) => (
                        <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                          onSelect={() => selectConv(c.id)}
                          onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                          onDelete={() => setDelConfirm(c.id)}
                        />
                      ))}
                    </div>
                  )}
                  {grouped.older.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-3 py-1.5">Avvalgi</p>
                      {grouped.older.map((c) => (
                        <ConvItem key={c.id} conv={c} isActive={activeId === c.id}
                          onSelect={() => selectConv(c.id)}
                          onRename={(t) => renameMut.mutate({ id: c.id, title: t })}
                          onDelete={() => setDelConfirm(c.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* User info footer */}
            {user && (
              <div className="px-4 py-3 border-t border-rim flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue/30 to-purple/30 flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-black text-blue">{user.email?.[0]?.toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-ink-strong truncate">{user.email}</p>
                  <p className="text-[9px] text-ink-faint capitalize">{user.role?.toLowerCase()}</p>
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ══ MAIN AREA ════════════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col h-full min-w-0">

        {/* ── Topbar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-rim bg-white/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? 'Yon panelni yopish' : 'Yon panelni ochish'}
              aria-expanded={sidebarOpen}
              className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:bg-tint hover:text-ink-soft transition-all"
            >
              <ChevronRight className={cn('h-4 w-4 transition-transform duration-200', sidebarOpen && 'rotate-180')} />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#af52de] via-[#5e5ce6] to-[#0071e3] flex items-center justify-center shadow-sm shadow-blue/15">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-black text-ink-strong leading-none line-clamp-1">
                  {activeTitle ?? 'BilgimAI'}
                </p>
                <p className="text-[10px] text-ink-faint mt-0.5 font-medium">
                  {msgs.length > 0 ? `${msgs.length} ta xabar` : "Yordamchi"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {activeId && (
              <>
                <button
                  onClick={() => clearMut.mutate(activeId)}
                  disabled={clearMut.isPending}
                  title="Suhbatni tozalash"
                  aria-label="Suhbatni tozalash"
                  className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-orange hover:bg-orange/8 transition-all"
                >
                  <Eraser className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDelConfirm(activeId)}
                  title="Suhbatni o'chirish"
                  aria-label="Suhbatni o'chirish"
                  className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-red hover:bg-red/8 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Mode selector ──────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-rim/60 bg-white/60 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-1.5 max-w-3xl mx-auto overflow-x-auto scrollbar-hide">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold border whitespace-nowrap transition-all shrink-0',
                  mode === m.id ? m.activeColor : m.color,
                )}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Messages area ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {!activeId ? (
            /* ── Welcome screen ─────────────────────────────────────── */
            <div className="flex flex-col items-center justify-center min-h-full px-6 py-12 text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                className="relative mb-8"
              >
                <div className="h-24 w-24 rounded-[2.5rem] bg-gradient-to-br from-[#af52de] via-[#5e5ce6] to-[#0071e3] flex items-center justify-center shadow-[0_20px_60px_-10px_rgba(0,113,227,0.45)]">
                  <Sparkles className="h-11 w-11 text-white" />
                </div>
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -bottom-1 -right-1 h-8 w-8 rounded-xl bg-green/15 border-2 border-white flex items-center justify-center shadow-sm"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-green animate-pulse" />
                </motion.div>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <h2 className="text-3xl font-black text-ink-strong tracking-tight mb-3">
                  Salom! Men BilgimAI
                </h2>
                <p className="text-base text-ink-soft max-w-lg leading-relaxed mb-10">
                  O&apos;qish, dars, tarjima, yoki har qanday savol bo&apos;yicha yordam beraman.
                  Fayllarni ham biriktirish mumkin.
                </p>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl w-full"
              >
                {STARTERS.map((s, idx) => (
                  <motion.button
                    key={s.label}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + idx * 0.05 }}
                    onClick={() => {
                      setMode(s.modeId);
                      setInput('');
                      // Test/Reja kabi maxsus prefix (foydalanuvchiga ko'rinmaydi, ichki ishlatiladi)
                      setStarterPrefix((s as { customPrefix?: string }).customPrefix ?? null);
                      setTimeout(() => taRef.current?.focus(), 50);
                    }}
                    className={cn(
                      'group flex flex-col items-start gap-2.5 rounded-2xl border bg-gradient-to-br p-4 text-left transition-all active:scale-[0.97] hover:shadow-sm',
                      s.color,
                    )}
                  >
                    <div className="h-8 w-8 rounded-xl bg-white/60 flex items-center justify-center shadow-sm">
                      <s.icon className="h-4 w-4 text-ink-soft" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-ink-strong">{s.label}</p>
                      <p className="text-[11px] text-ink-soft leading-snug mt-0.5">{s.hint}</p>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </div>
          ) : (
            /* ── Conversation messages ──────────────────────────────── */
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
              {convLoading && msgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <Loader2 className="h-7 w-7 animate-spin text-blue/40" />
                  <p className="text-xs text-ink-faint font-medium">Yuklanmoqda...</p>
                </div>
              ) : (
                <>
                  {msgs.map((m, idx) => (
                    <Message
                      key={m.id}
                      msg={m}
                      isLast={idx === msgs.length - 1}
                      sending={sending}
                      onRegenerate={m.role === 'assistant' ? regenerate : undefined}
                    />
                  ))}
                </>
              )}

              {/* Typing indicator */}
              {sending && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#af52de] via-[#5e5ce6] to-[#0071e3] flex items-center justify-center shadow-sm shadow-blue/20 mt-1">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-[1.4rem] rounded-tl-sm bg-white border border-rim/70 px-4 py-3 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="h-2 w-2 rounded-full bg-blue/40"
                          animate={{ y: [0, -5, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input area ─────────────────────────────────────────────── */}
        <div className="shrink-0 px-4 sm:px-6 pb-5 pt-3 bg-white/60 backdrop-blur-sm border-t border-rim/50">
          {/* File previews */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5 max-w-3xl mx-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-xl bg-white border border-rim px-2.5 py-1.5 shadow-sm">
                  {f.type.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 text-purple" /> : <FileText className="h-3.5 w-3.5 text-blue" />}
                  <span className="text-xs font-semibold text-ink-soft max-w-[100px] truncate">{f.name}</span>
                  <span className="text-[10px] text-ink-faint">{formatBytes(f.size)}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Faylni olib tashlash: ${f.name}`} className="ml-0.5 text-ink-faint hover:text-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 rounded">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-w-3xl mx-auto">
            <div className={cn(
              'relative flex flex-col rounded-2xl border bg-white transition-all duration-200 shadow-[0_2px_16px_rgba(0,0,0,0.06)] focus-within:border-blue/40 focus-within:ring-2 focus-within:ring-blue/15',
              input.length > 0
                ? 'border-blue/30 shadow-[0_4px_24px_rgba(0,113,227,0.12)]'
                : 'border-rim/70 hover:border-rim',
            )}>
              {/* Mode badge (when non-general) */}
              {mode !== 'general' && (
                <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
                  <div className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold border', activeMode.color)}>
                    {activeMode.icon}
                    {activeMode.label} rejimi
                  </div>
                  <button onClick={() => setMode('general')} aria-label="Rejimni tozalash" className="text-ink-faint hover:text-ink-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 rounded">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Textarea */}
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  if (e.target.value.length <= charLimit) {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                  }
                }}
                onKeyDown={handleKey}
                placeholder={activeMode.placeholder}
                rows={1}
                aria-label="BilgimAI uchun savol"
                className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-ink-strong placeholder-ink-faint outline-none leading-relaxed"
                style={{ maxHeight: 160 }}
              />

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="h-8 w-8 rounded-xl flex items-center justify-center text-ink-faint hover:text-blue hover:bg-blue/8 transition-all"
                    title="Fayl biriktirish"
                    aria-label="Fayl biriktirish"
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

                  {/* Quick mode buttons */}
                  <div className="flex items-center gap-0.5 ml-1">
                    {MODES.slice(1).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMode(mode === m.id ? 'general' : m.id)}
                        title={m.label}
                        aria-label={`${m.label} rejimi`}
                        aria-pressed={mode === m.id}
                        className={cn(
                          'h-7 w-7 rounded-lg flex items-center justify-center transition-all',
                          mode === m.id
                            ? m.activeColor.replace('border-', 'ring-1 ring-').split(' ')[0] + ' ' + m.activeColor.split(' ').slice(1).join(' ')
                            : 'text-ink-faint hover:text-ink-soft hover:bg-tint',
                        )}
                      >
                        {m.icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {charCount > 0 && (
                    <span className={cn(
                      'text-[10px] font-medium',
                      charCount > charLimit * 0.9 ? 'text-orange' : 'text-ink-faint',
                    )}>
                      {charCount}/{charLimit}
                    </span>
                  )}
                  <button
                    onClick={() => send(input)}
                    disabled={!input.trim() || sending}
                    aria-label="Yuborish"
                    className={cn(
                      'h-8 w-8 rounded-xl flex items-center justify-center text-white transition-all active:scale-90 shadow-sm',
                      input.trim() && !sending
                        ? 'bg-blue hover:bg-blue/90 shadow-blue/20'
                        : 'bg-ink-faint/30 cursor-not-allowed',
                    )}
                  >
                    {sending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ArrowUp className="h-4 w-4" />
                    }
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-[10px] text-ink-faint mt-2 font-medium">
              <span className="opacity-60">Enter</span>
              {' — yuborish · '}
              <span className="opacity-60">Shift+Enter</span>
              {' — yangi qator · '}
              BilgimAI xato qilishi mumkin
            </p>
          </div>
        </div>
      </div>

      {/* ══ DELETE CONFIRM DIALOG ════════════════════════════════════════ */}
      <AnimatePresence>
        {delConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/20 backdrop-blur-sm p-4"
            onClick={() => setDelConfirm(null)}
          >
            <motion.div
              ref={delDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="del-confirm-title"
              tabIndex={-1}
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-[2.5rem] border border-rim bg-white p-8 shadow-2xl focus-visible:outline-none"
            >
              <div className="h-14 w-14 rounded-2xl bg-red/8 border border-red/15 flex items-center justify-center mx-auto mb-5">
                <Trash2 className="h-7 w-7 text-red" />
              </div>
              <h3 id="del-confirm-title" className="text-lg font-black text-ink-strong text-center mb-2">Suhbatni o&apos;chirish</h3>
              <p className="text-sm text-ink-soft text-center leading-relaxed mb-6">
                Bu suhbat va barcha xabarlar o&apos;chib ketadi. Bu amalni qaytarib bo&apos;lmaydi.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDelConfirm(null)}
                  className="flex-1 rounded-2xl border border-rim py-3 text-sm font-black text-ink-soft hover:bg-tint transition-all"
                >
                  Bekor
                </button>
                <button
                  onClick={() => { if (delConfirm) { deleteMut.mutate(delConfirm); setDelConfirm(null); } }}
                  disabled={deleteMut.isPending}
                  className="flex-1 rounded-2xl bg-red py-3 text-sm font-black text-white hover:bg-red/90 transition-all active:scale-95 shadow-sm shadow-red/20 disabled:opacity-60"
                >
                  {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "O'chirish"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
