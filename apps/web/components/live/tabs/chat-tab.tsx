'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@livekit/components-react';
import { Send, Smile, Paperclip, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';

export function ChatTab() {
  const { chatMessages, send } = useChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {chatMessages.map((m) => {
          const isMe = m.from?.isLocal;
          const sender = m.from?.name || m.from?.identity || 'Anonim';
          const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
              <div className="flex items-baseline gap-2 mb-1.5 px-1">
                <span className="text-[10px] font-black text-ink-faint uppercase tracking-widest">{sender}</span>
                <span className="text-[9px] font-medium text-ink-ghost">{time}</span>
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
        })}
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-rim space-y-4 bg-tint">
        <div className="flex items-center gap-1">
            <ActionButton icon={Paperclip} />
            <ActionButton icon={ImageIcon} />
            <ActionButton icon={Smile} />
        </div>
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Xabar yozing..."
            className="w-full rounded-2xl border border-rim bg-white px-5 py-3 pr-12 text-sm font-medium text-ink-strong placeholder:text-ink-faint outline-none focus:border-blue/40 focus:ring-4 focus:ring-blue/10 transition-all"
          />
          <button
            onClick={handleSend}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-xl bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)] hover:bg-blue-600 transition-all active:scale-90"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon }: { icon: any }) {
    return (
        <button className="p-2 rounded-xl text-ink-faint hover:text-ink-strong hover:bg-white transition-all">
            <Icon className="h-4 w-4" />
        </button>
    );
}
