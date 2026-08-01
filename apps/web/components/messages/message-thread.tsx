'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import {
  Send,
  Paperclip,
  X,
  User,
  MessageCircle,
  Clock,
  AlertTriangle,
  Smile,
  ShieldAlert,
  Loader2,
  Check,
  CheckCheck,
  File as FileIcon,
  FileUp,
  Image as ImageIcon,
  Video,
  FileText,
  ExternalLink,
  Download,
  Play,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

import { dmApi, type DmMessage } from '../../lib/api/dm';
import type { MediaAssetBatchResult } from '../../lib/api/media';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../../lib/auth';
import { useAssetBatch } from '../../lib/hooks/use-asset-batch';
import { getLiveSocket } from '../../lib/socket';
import { uploadFile } from '../../lib/upload';
import { cn } from '../../lib/utils';
import { HlsPlayer } from '../lesson/hls-player';
import { Lightbox } from '../ui/lightbox';
import { CircularProgress } from '../ui/circular-progress';

interface MessageThreadProps {
  threadId: string;
  /** When provided, treats the room as a lesson (group) chat. */
  lessonId?: string | null;
}

interface DraftAttachment {
  file: File;
  /** Media asset id returned from the upload endpoint, if available. */
  assetId?: string;
  /** Presigned URL returned from complete upload. */
  assetUrl?: string;
  /** Original filename. */
  filename: string;
  /** Bytes — used for the inline preview. */
  size: number;
  progress?: number;
  isUploading?: boolean;
}

interface OptimisticMessage {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: 'uploading' | 'completed' | 'failed';
  text?: string;
  errorMessage?: string;
  createdAt: string;
}

type AttachmentMode = 'image' | 'video' | 'document';

const MAX_CHAT_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

const ATTACHMENT_ACCEPT: Record<AttachmentMode, string> = {
  image: 'image/*',
  video: 'video/*',
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-7z-compressed',
    'application/vnd.rar',
    'application/x-tar',
    'application/gzip',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
  ].join(','),
};

export function MessageThread({ threadId, lessonId }: MessageThreadProps): React.ReactElement {
  const queryClient = useQueryClient();
  const threadQuery = useQuery({
    queryKey: ['dm', 'thread', threadId],
    queryFn: () => dmApi.getThread(threadId),
    enabled: !!threadId && !lessonId,
  });

  const messagesQuery = useQuery({
    queryKey: ['dm', 'messages', threadId],
    queryFn: () => dmApi.listMessages(threadId, { pageSize: 100 }),
    // Interim safety net for missed socket events, not the primary sync
    // path — the socket handler below patches new messages into this
    // query's cache directly. 60s (was 30s) until the Phase 1 realtime
    // rework (ack'd sends + reconnect resync) removes polling entirely.
    refetchInterval: 60_000,
    enabled: !!threadId,
  });

  const [draft, setDraft] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentMode, setAttachmentMode] = useState<AttachmentMode>('document');
  const [attachmentWarning, setAttachmentWarning] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUser = useMemo(() => getCurrentUser(), []);
  const myId = currentUser?.sub ?? null;
  const messages = messagesQuery.data?.items ?? [];
  const thread = threadQuery.data;

  // Mark as read when thread is opened or a new message arrives. Keyed on
  // the latest message's id (messages are newest-first) rather than
  // `messages.length` — loading older history via pagination changes the
  // length without changing `messages[0]`, so that no longer re-fires the
  // PATCH on every page of loaded history.
  const latestMessageId = messages[0]?.id ?? null;
  useEffect(() => {
    if (!threadId || !latestMessageId || messagesQuery.isLoading || messagesQuery.isError) {
      return;
    }
    dmApi.markRead(threadId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['dm', 'unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
    });
  }, [threadId, latestMessageId, messagesQuery.isLoading, messagesQuery.isError, queryClient]);

  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [rateLimitedUntil]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTo({
        top: node.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages.length, optimisticMessages.length]);

  useEffect(() => {
    if (!threadId) return;
    let socket: Socket | null = null;
    try {
      socket = getLiveSocket();
    } catch {
      return;
    }

    const roomKey = lessonId ?? threadId;

    function emitJoin() {
      if (!socket) return;
      socket.emit(
        'chat:join',
        lessonId
          ? { lessonId }
          : { lessonId: `dm:${threadId}` },
      );
    }

    function handleConnect() {
      emitJoin();
    }

    function handleMessage(payload: {
      lessonId?: string;
      senderId?: string;
      text?: string;
      assetId?: string;
      assetUrl?: string;
      ts?: number;
      messageId?: string;
    }) {
      if (!payload || (typeof payload.text !== 'string' && !payload.assetId)) return;
      if (payload.lessonId && payload.lessonId !== `dm:${threadId}` &&
          payload.lessonId !== lessonId) {
        return;
      }
      queryClient.setQueryData<{
        items: DmMessage[];
        nextCursor: string | null;
      }>(['dm', 'messages', threadId], (prev) => {
        if (!prev) return prev;

        const isDuplicate =
          (payload.messageId && prev.items.some((m) => m.id === payload.messageId)) ||
          prev.items.some((m) => !m.id.startsWith('socket-') && !m.id.startsWith('opt-') && m.id === payload.messageId);

        if (isDuplicate) {
          return prev;
        }

        const message: DmMessage = {
          id:
            payload.messageId ??
            `socket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          threadId,
          authorId: payload.senderId ?? 'unknown',
          text: payload.text ?? '',
          assetId: payload.assetId ?? null,
          createdAt: new Date(payload.ts ?? Date.now()).toISOString(),
        };
        return {
          ...prev,
          items: [message, ...prev.items],
        };
      });
    }

    socket.on('connect', handleConnect);
    socket.on('chat:message', handleMessage);
    if (socket.connected) {
      emitJoin();
    }

    return () => {
      if (!socket) return;
      socket.off('connect', handleConnect);
      socket.off('chat:message', handleMessage);
      socket.emit(
        'chat:leave',
        lessonId
          ? { lessonId }
          : { lessonId: `dm:${threadId}` },
      );
      void roomKey;
    };
  }, [threadId, lessonId, queryClient]);

  const sendMutation = useMutation({
    mutationFn: ({ text, assetId }: { text: string; assetId?: string }) =>
      dmApi.sendMessage(threadId, text, assetId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dm', 'messages', threadId] });
      queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
      setDraft('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.statusCode === 429) {
        const details = err.details as
          | { code?: string; windowSeconds?: number }
          | undefined;
        const seconds =
          typeof details?.windowSeconds === 'number'
            ? details.windowSeconds
            : 24 * 60 * 60;
        setRateLimitedUntil(Date.now() + seconds * 1000);
      }
    },
  });

  const remainingSeconds =
    rateLimitedUntil !== null
      ? Math.max(0, Math.ceil((rateLimitedUntil - now) / 1000))
      : 0;
  const isRateLimited =
    rateLimitedUntil !== null && rateLimitedUntil > now;

  async function startUpload(file: File, optId: string) {
    try {
      const result = await uploadFile(file, (percent) => {
        setOptimisticMessages(prev =>
          prev.map(m => m.id === optId ? { ...m, progress: percent } : m)
        );
      });

      // 1. AVVAL optimistic'ni o'chir
      setOptimisticMessages(prev => prev.filter(m => m.id !== optId));

      // 2. SO'NGRA xabarni yubor
      const assetId = typeof result === 'string' ? result : (result as any).assetId;
      await dmApi.sendMessage(threadId, undefined, assetId);

      // 3. Server'dan fresh data ol (socket event ham keladi, ikkalasi deduplication bilan ishlaydi)
      queryClient.invalidateQueries({ queryKey: ['dm', 'messages', threadId] });
      queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });

    } catch (err) {
      console.error('Upload failed', err);
      const message = describeUploadError(err);
      setOptimisticMessages(prev =>
        prev.map(m => m.id === optId ? { ...m, status: 'failed', errorMessage: message } : m)
      );
    }
  }
  function queueFile(file: File) {
    if (!file) return;
    if (file.size > MAX_CHAT_FILE_SIZE_BYTES) {
      setAttachmentWarning(
        `${file.name} hajmi ${formatSize(file.size)}. Chatda maksimal fayl hajmi 1 GB.`,
      );
      return;
    }
    setAttachmentWarning(null);

    const optId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);

    const optMsg: OptimisticMessage = {
      id: optId,
      file,
      previewUrl,
      progress: 0,
      status: 'uploading',
      createdAt: new Date().toISOString(),
    };

    setOptimisticMessages(prev => [...prev, optMsg]);
    startUpload(file, optId);
  }

  async function handleAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    files.forEach(queueFile);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function openFilePicker(mode: AttachmentMode) {
    setAttachmentMode(mode);
    setAttachmentMenuOpen(false);
    requestAnimationFrame(() => fileInputRef.current?.click());
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    files.forEach(queueFile);
  }

  function handleDrop(e: React.DragEvent<HTMLElement>) {
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    setIsDraggingFile(false);
    files.forEach(queueFile);
  }

  function handleRetry(optId: string) {
    const opt = optimisticMessages.find(m => m.id === optId);
    if (!opt) return;

    setOptimisticMessages(prev =>
      prev.map(m => {
        if (m.id !== optId) return m;
        const { errorMessage: _errorMessage, ...rest } = m;
        return { ...rest, status: 'uploading', progress: 0 };
      })
    );
    startUpload(opt.file, optId);
  }

  function handleCancelOptimistic(optId: string) {
    setOptimisticMessages(prev => {
      const message = prev.find(m => m.id === optId);
      if (message) URL.revokeObjectURL(message.previewUrl);
      return prev.filter(m => m.id !== optId);
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isRateLimited || sendMutation.isPending) return;

    const text = draft.trim();
    if (!text) return;

    sendMutation.mutate({ text });
  }

  const ordered = useMemo(() => [...messages].reverse(), [messages]);
  const assetBatch = useAssetBatch(ordered.map((m) => m.assetId));

  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 flex-1 flex-col bg-canvas",
        isDraggingFile && "ring-4 ring-inset ring-blue/20"
      )}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setIsDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-[2rem] border-2 border-dashed border-blue/35 bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-blue">
            <FileUp className="h-9 w-9" />
            <p className="text-sm font-extrabold">Faylni yuborish uchun tashlang</p>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-rim bg-white/80 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue/5 text-blue shadow-sm border border-blue/10 overflow-hidden">
            {thread?.peer.avatarUrl && !avatarError ? (
              <img
                src={thread.peer.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarError(true)}
              />
            ) : thread?.peer.fullName ? (
              <span className="font-display text-sm font-bold uppercase">{thread.peer.fullName.charAt(0)}</span>
            ) : (
              <MessageCircle className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-extrabold text-ink-strong truncate">
              {lessonId ? 'Guruh suhbati' : (thread?.peer.fullName ?? 'Shaxsiy suhbat')}
            </h2>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue animate-pulse" />
              Real vaqt rejimi
            </div>
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-6 overflow-y-auto px-6 py-8 scroll-smooth"
      >
        {messagesQuery.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue/30" />
          </div>
        ) : messagesQuery.isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldAlert className="mb-4 h-12 w-12 text-red/20" />
            <p className="max-w-xs text-sm font-medium text-red/60">
              {messagesQuery.error instanceof ApiClientError
                ? messagesQuery.error.message
                : 'Xabarlarni yuklab bo\'lmadi.'}
            </p>
          </div>
        ) : ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[2.5rem] bg-tint text-ink-faint opacity-50">
              <Smile className="h-10 w-10" />
            </div>
            <p className="max-w-xs text-sm font-medium text-ink-faint">
              Suhbatni boshlash uchun xabar yuboring. Xabarlaringiz xavfsiz va himoyalangan.
            </p>
          </div>
        ) : (
          <>
            {ordered.map((m, idx) => {
              const isMine = m.authorId === myId;
              const prev = ordered[idx - 1];
              const showAvatar = !isMine && (!prev || prev.authorId !== m.authorId);

              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isMine={isMine}
                  showAvatar={showAvatar}
                  {...(thread?.peer.fullName ? { peerName: thread.peer.fullName } : {})}
                  {...(thread?.peer.avatarUrl !== undefined ? { peerAvatar: thread.peer.avatarUrl } : {})}
                  resolved={m.assetId ? assetBatch.byAssetId.get(m.assetId) : undefined}
                />
              );
            })}
            {optimisticMessages.map((opt) => (
              <MessageBubble
                key={opt.id}
                isMine={true}
                showAvatar={false}
                optimistic={opt}
                onRetry={() => handleRetry(opt.id)}
                onCancel={() => handleCancelOptimistic(opt.id)}
                message={{
                  id: opt.id,
                  authorId: myId ?? '',
                  threadId,
                  text: opt.text ?? '',
                  createdAt: opt.createdAt,
                  assetId: null,
                }}
              />
            ))}
          </>
        )}
      </div>

      <div className="p-6">
        <form
          onSubmit={handleSubmit}
          className="relative rounded-[2rem] border border-rim bg-white p-2 shadow-soft transition-all focus-within:border-blue/30 focus-within:ring-4 focus-within:ring-blue/5"
        >
          {isRateLimited && (
            <div className="absolute -top-24 left-0 right-0 p-4">
              <div className="flex items-center gap-3 rounded-2xl border border-orange/20 bg-orange-tint p-4 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-orange" />
                <div className="text-xs font-bold text-orange/80 leading-relaxed">
                  Cheklov: <strong>{formatCountdown(remainingSeconds)}</strong> dan keyin xabar yuborishingiz mumkin.
                </div>
              </div>
            </div>
          )}

          {sendMutation.isError && !isRateLimited && (
            <div className="absolute -top-16 left-0 right-0 p-4">
              <div className="flex items-center gap-2 rounded-xl bg-red-tint px-4 py-2 text-xs font-bold text-red border border-red/10">
                <ShieldAlert className="h-4 w-4" />
                {sendMutation.error instanceof ApiClientError ? sendMutation.error.message : 'Xatolik yuz berdi.'}
              </div>
            </div>
          )}

          {attachmentWarning && (
            <div className="mb-2 flex items-center gap-3 rounded-2xl border border-orange/20 bg-orange-tint px-4 py-3 text-xs font-bold text-orange">
              <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
              <span className="min-w-0 flex-1">{attachmentWarning}</span>
              <button
                type="button"
                onClick={() => setAttachmentWarning(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-orange/10"
                aria-label="Ogohlantirishni yopish"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 px-2">
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setAttachmentMenuOpen((value) => !value)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-2xl text-ink-faint transition-all active:scale-90 hover:bg-tint hover:text-blue",
                  attachmentMenuOpen && "bg-tint text-blue"
                )}
                aria-label="Fayl biriktirish"
              >
                <Paperclip className="h-5 w-5" />
              </button>

              {attachmentMenuOpen && (
                <div className="absolute bottom-14 left-0 z-30 w-48 overflow-hidden rounded-2xl border border-rim bg-white p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => openFilePicker('image')}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-ink-strong transition-colors hover:bg-blue/5 hover:text-blue"
                  >
                    <ImageIcon className="h-4.5 w-4.5" />
                    Rasm yuborish
                  </button>
                  <button
                    type="button"
                    onClick={() => openFilePicker('video')}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-ink-strong transition-colors hover:bg-blue/5 hover:text-blue"
                  >
                    <Video className="h-4.5 w-4.5" />
                    Video yuborish
                  </button>
                  <button
                    type="button"
                    onClick={() => openFilePicker('document')}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-ink-strong transition-colors hover:bg-blue/5 hover:text-blue"
                  >
                    <FileText className="h-4.5 w-4.5" />
                    Hujjat yuborish
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleAttach}
                className="hidden"
                accept={ATTACHMENT_ACCEPT[attachmentMode]}
              />
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!isRateLimited && !sendMutation.isPending) {
                    handleSubmit(e as unknown as FormEvent<HTMLFormElement>);
                  }
                }
              }}
              rows={1}
              placeholder="Sizning xabaringiz..."
              disabled={isRateLimited}
              className="flex-1 max-h-32 min-h-[2.75rem] py-3 text-sm font-medium text-ink-strong placeholder:text-ink-faint bg-transparent outline-none resize-none scrollbar-hide"
            />

            <button
              type="submit"
              disabled={isRateLimited || sendMutation.isPending || draft.trim().length === 0}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all active:scale-90 shadow-sm",
                draft.trim() && !isRateLimited && !sendMutation.isPending
                  ? "bg-blue text-white shadow-blue-soft"
                  : "bg-tint text-ink-faint"
              )}
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5 ml-0.5" />
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MessageBubble({
  message,
  isMine,
  showAvatar,
  peerName,
  peerAvatar,
  optimistic,
  onRetry,
  onCancel,
  resolved,
}: {
  message: DmMessage;
  isMine: boolean;
  showAvatar: boolean;
  peerName?: string;
  peerAvatar?: string | null;
  optimistic?: OptimisticMessage;
  onRetry?: () => void;
  onCancel?: () => void;
  /** Batched metadata/playback lookup result for `message.assetId` (see `useAssetBatch`). */
  resolved?: MediaAssetBatchResult | undefined;
}): React.ReactElement {
  const isPersisted = !message.id.startsWith('socket-') && !message.id.startsWith('opt-');
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const assetMeta = resolved?.metadata ?? null;
  // A message that just arrived over the socket carries its own signed
  // URL (`message.assetUrl`) before the batch query has caught up —
  // prefer that so playback isn't blocked on the next batch refetch.
  const playback = resolved?.playback
    ? { url: resolved.playback.url, type: resolved.playback.type }
    : message.assetUrl
      ? { url: message.assetUrl, type: 'original' }
      : null;

  const isImage = optimistic ? optimistic.file.type.startsWith('image/') : assetMeta?.kind === 'IMAGE';
  const isVideo = optimistic ? optimistic.file.type.startsWith('video/') : assetMeta?.kind === 'VIDEO';
  const previewUrl = optimistic ? optimistic.previewUrl : playback?.url;

  return (
    <div className={cn(
      "group flex w-full gap-3 transition-all",
      isMine ? "flex-row-reverse" : "flex-row",
      !showAvatar && !isMine && "pl-11"
    )}>
      {!isMine && showAvatar && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-tint border border-rim shadow-sm overflow-hidden">
          {peerAvatar ? (
            <img src={peerAvatar} alt="" className="h-full w-full object-cover" />
          ) : peerName ? (
            <span className="font-display text-[10px] font-bold uppercase text-blue">{peerName.charAt(0)}</span>
          ) : (
            <User className="h-4 w-4 text-ink-faint" />
          )}
        </div>
      )}

      <div className={cn(
        "flex max-w-[80%] flex-col gap-1",
        isMine ? "items-end" : "items-start"
      )}>
        <div
          className={cn(
            "relative rounded-[1.5rem] px-5 py-3 text-sm font-medium leading-relaxed shadow-sm transition-all group-hover:shadow-medium overflow-hidden",
            isMine
              ? "bg-blue text-white rounded-tr-none"
              : "bg-white border border-rim text-ink-strong rounded-tl-none"
          )}
        >
          {/* Optimistic Preview / Upload State */}
          {optimistic && (
            <div className="relative mb-2 overflow-hidden rounded-xl border border-white/10 shadow-sm min-w-[200px] min-h-[150px] bg-tint-strong/5 flex items-center justify-center">
              {isImage && (
                <img src={optimistic.previewUrl} alt="" className="max-h-60 w-full object-cover opacity-50" />
              )}
              {isVideo && (
                <video src={optimistic.previewUrl} className="max-h-60 w-full object-cover opacity-50" />
              )}
              {!isImage && !isVideo && (
                <div className="flex flex-col items-center gap-2 p-4 text-ink-faint">
                  <FileIcon className="h-10 w-10 opacity-20" />
                  <span className="text-[10px] font-bold uppercase truncate max-w-[150px]">
                    {optimistic.file.name}
                  </span>
                </div>
              )}

              {/* Overlay for Progress or Error */}
              <div className="absolute inset-0 flex items-center justify-center bg-tint-strong/20 backdrop-blur-[2px]">
                {optimistic.status === 'uploading' && (
                  <CircularProgress progress={optimistic.progress} size={48} strokeWidth={4} />
                )}
                {optimistic.status === 'failed' && (
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={onRetry}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-strong shadow-lg active:scale-95 transition-transform"
                      title="Qayta urinish"
                    >
                      <RefreshCw className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-white bg-red/80 px-2 py-0.5 rounded-full">
                      <AlertCircle className="h-3 w-3" />
                      {optimistic.errorMessage ?? 'Xatolik'}
                    </div>
                  </div>
                )}
              </div>

              {/* Cancel Button */}
              {optimistic.status !== 'completed' && (
                <button
                  onClick={onCancel}
                  className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-tint-strong/50 text-white hover:bg-tint-strong/80 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Real Media Content */}
          {!optimistic && assetMeta && playback && (
            <div className="mb-2 space-y-2">
              {assetMeta.kind === 'IMAGE' && (
                <div
                  className="cursor-zoom-in overflow-hidden rounded-xl border border-white/10 shadow-sm"
                  onClick={() => setIsLightboxOpen(true)}
                >
                  <img src={playback.url} alt={assetMeta.fileName} className="max-h-60 w-full object-cover" />
                </div>
              )}

              {assetMeta.kind === 'VIDEO' && (
                <div className="w-full max-w-sm">
                  <HlsPlayer
                    src={playback.url}
                    type={playback.type as 'manifest' | 'variant' | 'original'}
                    className="rounded-xl border border-white/10 shadow-sm"
                  />
                </div>
              )}

              {(assetMeta.kind === 'AUDIO' || assetMeta.kind === 'PDF' || assetMeta.kind === 'DOC' || assetMeta.kind === 'SHEET' || assetMeta.kind === 'OTHER') && (
                <div className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 shadow-sm transition-colors",
                  isMine ? "bg-white/10 border-white/20 text-white" : "bg-tint/30 border-rim text-ink-strong"
                )}>
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg shadow-inner",
                    isMine ? "bg-white/15" : "bg-white border border-rim"
                  )}>
                    {assetMeta.contentType.includes('pdf') || assetMeta.kind === 'PDF' ? (
                      <FileText className="h-5 w-5 text-red-500" />
                    ) : assetMeta.kind === 'AUDIO' ? (
                      <Play className="h-5 w-5 text-blue" />
                    ) : (
                      <FileIcon className="h-5 w-5 text-blue" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold leading-tight">{assetMeta.fileName}</p>
                    <p className={cn("text-[10px] font-medium opacity-60", isMine ? "text-white" : "text-ink-faint")}>
                      {formatSize(assetMeta.sizeBytes)}
                    </p>
                  </div>
                  <a
                    href={playback.url}
                    download={assetMeta.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-all active:scale-90",
                      isMine ? "hover:bg-white/10 text-white" : "hover:bg-white text-ink-strong border border-rim"
                    )}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          )}

          {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        </div>

        <div className={cn(
          "flex items-center gap-1.5 px-1 opacity-0 transition-opacity group-hover:opacity-100",
          isMine ? "flex-row-reverse" : "flex-row"
        )}>
          <span className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
            {formatClock(message.createdAt)}
          </span>
          {isMine && !optimistic && (
            <span className="text-blue" aria-label={isPersisted ? 'Yetkazildi' : 'Yuborildi'}>
              {isPersisted ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            </span>
          )}
          {isMine && optimistic && (
            <span className="text-ink-faint">
              <Clock className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      {isLightboxOpen && playback && (
        <Lightbox
          src={playback.url}
          {...(assetMeta?.fileName ? { alt: assetMeta.fileName } : {})}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}
    </div>
  );
}

function formatClock(input: string): string {
  try {
    return new Date(input).toLocaleTimeString('uz-UZ', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours} soat ${minutes} daqiqa`;
  if (minutes > 0) return `${minutes} daqiqa ${secs} soniya`;
  return `${secs} soniya`;
}

function describeUploadError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const details = error.details as { code?: string; message?: string } | undefined;
    const text = details?.message ?? error.message;
    if (
      details?.code === 'MEDIA_CONTENT_TYPE_NOT_ALLOWED' ||
      details?.code === 'MEDIA_KIND_NOT_UPLOADABLE'
    ) {
      return 'Fayl turi qo‘llanmaydi';
    }
    if (text.toLowerCase().includes('bucket')) {
      return 'Media ombori tayyor emas';
    }
    if (isUntranslatedBackendMessage(text)) {
      return 'Serverda kutilmagan xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring';
    }
    return text.length > 36 ? `${text.slice(0, 33)}...` : text;
  }
  if (error instanceof Error) {
    if (error.message.includes('Missing ETag')) {
      return 'ETag CORS ruxsati yo‘q';
    }
    if (error.message.includes('Network')) {
      return 'Tarmoq xatosi';
    }
    if (isUntranslatedBackendMessage(error.message)) {
      return 'Serverda kutilmagan xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring';
    }
    return error.message.length > 36 ? `${error.message.slice(0, 33)}...` : error.message;
  }
  return 'Upload xatosi';
}

/** Backend fallback errors (e.g. the generic 500 handler) come through in
 * English with no error code to key off of. Detect plain-ASCII-only text
 * with no Uzbek-specific characters so it never leaks untranslated into
 * the chat UI. */
function isUntranslatedBackendMessage(text: string): boolean {
  return /^[\x20-\x7E]*$/.test(text) && /[a-zA-Z]/.test(text);
}
