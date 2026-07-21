'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, X, Send, Loader2, ChevronDown,
  RotateCcw, Bot, User,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const STARTERS = [
  "Darsimga qanday yordam bera olasiz?",
  "Bu mavzuni tushuntiring",
  "Vazifamni qanday bajaray?",
  "O'qish strategiyasi haqida maslahat bering",
];

export function AiChatWidget({ role }: { role: 'STUDENT' | 'TEACHER' | 'ADMIN' }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setHasUnread(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: Message = { role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setLoading(true);

      try {
        const res = await apiClient.post<{ reply: string }>('/ai/chat', {
          message: trimmed,
          history: messages.slice(-10),
          locale: 'uz',
        });

        const assistantMsg: Message = { role: 'assistant', content: res.reply };
        setMessages((prev) => [...prev, assistantMsg]);
        if (!open) setHasUnread(true);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: "Kechirasiz, xatolik yuz berdi. Qayta urinib ko'ring." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, open],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-[300]">
        <AnimatePresence>
          {!open && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => setOpen(true)}
              className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue to-purple text-white shadow-[0_8px_30px_rgba(0,113,227,0.5)] transition-all hover:scale-105 active:scale-95"
            >
              <Sparkles className="h-6 w-6" />
              {hasUnread && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-400 border-2 border-white animate-bounce" />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[300] flex flex-col w-[380px] max-h-[580px] rounded-[2rem] border border-white/[0.08] bg-[#0f0f1a]/95 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)] backdrop-blur-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue to-purple flex items-center justify-center shadow-lg shadow-blue/20">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">BilgimAI</p>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Aktiv</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="h-8 w-8 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/30 hover:text-white/60 transition-all"
                    title="Suhbatni tozalash"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="h-8 w-8 rounded-xl hover:bg-white/5 flex items-center justify-center text-white/30 hover:text-white/60 transition-all"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue to-purple flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm bg-white/[0.06] px-4 py-3 text-sm text-white/80 leading-relaxed max-w-[280px]">
                      Salom! Men BilgimAI — sizning o'quv yordamchingizman. Qanday yordam bera olaman?
                    </div>
                  </div>
                  <div className="space-y-2 pl-10">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="w-full text-left text-xs font-medium text-white/50 hover:text-white/80 rounded-xl border border-white/[0.06] hover:border-white/[0.12] px-3 py-2 transition-all hover:bg-white/[0.04]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {msg.role === 'assistant' && (
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue to-purple flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[280px] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-blue text-white'
                        : 'rounded-tl-sm bg-white/[0.06] text-white/80',
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-white/60" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue to-purple flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-white/[0.06] px-4 py-3">
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-white/[0.06] p-3">
              <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Savolingizni yozing..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-white placeholder-white/30 outline-none max-h-32 leading-relaxed"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = 'auto';
                    t.style.height = t.scrollHeight + 'px';
                  }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || loading}
                  className="h-8 w-8 shrink-0 rounded-xl bg-blue flex items-center justify-center text-white transition-all hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed active:scale-90"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-white/15">
                BilgimAI • Enter = yuborish
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
