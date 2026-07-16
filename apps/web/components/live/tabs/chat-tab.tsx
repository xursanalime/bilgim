'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@livekit/components-react';
import { Send, Smile, MessageSquare } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useFocusTrap } from '../../../lib/a11y/use-focus-trap';

const EMOJIS = ['🙂', '👍', '🎉', '❤️', '😂', '👏', '🙏', '🔥', '✅', '❓'] as const;

export function ChatTab() {
  const { chatMessages, send } = useChat();
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);

  // Custom (non-Radix) emoji popover: trap Tab focus, close on Esc, and restore
  // focus to the toggle button when it closes (Req 7.1, 7.2, 7.3).
  useFocusTrap(emojiMenuRef, {
    active: showEmoji,
    onClose: () => setShowEmoji(false),
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Close the emoji popover on outside click.
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const insertEmoji = (emoji: string) => {
    setInput((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    try {
      await send(input);
      setInput('');
    } catch (err) {
      console.error('Failed to send message', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Messages Area */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Jonli chat xabarlari"
        aria-live="polite"
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
      >
        {chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center gap-3 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint border border-rim">
              <MessageSquare className="h-5 w-5 text-ink-faint" aria-hidden="true" />
            </div>
            <p className="text-xs font-bold text-ink-soft">Hali xabarlar yo&apos;q</p>
            <p className="text-[11px] text-ink-faint leading-relaxed">Birinchi bo&apos;lib xabar yozing.</p>
          </div>
        ) : (
          chatMessages.map((m) => {
            const isMe = m.from?.isLocal;
            const sender = m.from?.name || m.from?.identity || 'Anonim';
            const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                <div className="flex items-baseline gap-2 mb-1.5 px-1">
                  <span className="text-[10px] font-black text-ink-soft uppercase tracking-widest">{sender}</span>
                  <span className="text-[9px] font-medium text-ink-faint">{time}</span>
                </div>
                <div className={cn(
                  "max-w-[90%] rounded-[1.25rem] px-4 py-2.5 text-sm shadow-sm transition-all",
                  isMe
                    ? "bg-blue text-white rounded-tr-none shadow-blue/20"
                    : "bg-tint text-ink-strong rounded-tl-none border border-rim"
                )}>
                  {m.message}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Area */}
      <form
        className="p-6 border-t border-rim space-y-4 bg-tint/40"
        onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
      >
        <div className="relative flex items-center gap-1" ref={emojiWrapRef}>
          <button
            type="button"
            aria-label="Emoji qo'shish"
            aria-expanded={showEmoji}
            title="Emoji qo'shish"
            onClick={() => setShowEmoji((v) => !v)}
            className={cn(
              'p-2 rounded-xl outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue',
              showEmoji ? 'bg-blue text-white' : 'text-ink-soft hover:text-ink-strong hover:bg-soft'
            )}
          >
            <Smile className="h-4 w-4" aria-hidden="true" />
          </button>

          {showEmoji && (
            <div
              ref={emojiMenuRef}
              role="menu"
              aria-label="Emoji tanlash"
              className="absolute bottom-full left-0 mb-2 grid grid-cols-5 gap-1 rounded-2xl border border-rim bg-canvas p-2 shadow-medium animate-in fade-in zoom-in-95 duration-150"
            >
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`Emoji ${emoji}`}
                  onClick={() => insertEmoji(emoji)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg outline-none transition-all hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <label htmlFor="live-chat-input" className="sr-only">Xabar yozing</label>
          <input
            id="live-chat-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Xabar yozing..."
            autoComplete="off"
            className="w-full rounded-2xl border border-rim bg-tint px-5 py-3 pr-12 text-sm font-medium text-ink-strong placeholder:text-ink-faint outline-none focus:border-blue/40 focus:bg-canvas focus-visible:ring-2 focus-visible:ring-blue/40 transition-all"
          />
          <button
            type="submit"
            aria-label="Xabarni yuborish"
            disabled={!input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-xl bg-blue text-white shadow-lg shadow-blue/40 outline-none hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas transition-all active:scale-90 disabled:opacity-40 disabled:active:scale-100"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
