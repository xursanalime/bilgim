'use client';

import { MessageSquare, MousePointer2 } from 'lucide-react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { ConversationList } from '../../../../components/messages/conversation-list';
import { NewMessageDialog } from '../../../../components/messages/new-message-dialog';

interface MessagesPageProps {
  params: { locale: string };
}

export default function MessagesPage({
  params: { locale },
}: MessagesPageProps) {
  return (
    <div className="flex h-full flex-col lg:flex-row bg-canvas rounded-[2.5rem] border border-rim overflow-hidden shadow-soft">
      <ConversationList locale={locale} activeThreadId={null} />
      
      <section className="hidden flex-1 items-center justify-center text-center lg:flex bg-tint/10">
        <div className="max-w-md space-y-8 px-10 py-16">
          <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-[2.5rem] bg-blue/5 text-blue shadow-sm border border-blue/10">
            <div className="absolute -inset-4 rounded-full bg-blue/5 blur-2xl animate-pulse" />
            <MessageSquare className="relative h-10 w-10" />
            
            <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-rim shadow-sm">
              <MousePointer2 className="h-4 w-4 text-ink-faint" />
            </div>
          </div>
          
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong">
              Suhbatni tanlang
            </h2>
            <p className="text-sm leading-relaxed text-ink-soft opacity-70">
              Chap tarafdagi roʻyxatdan kerakli suhbatni tanlang yoki yangi oʻqituvchi bilan muloqotni boshlash uchun pastdagi tugmani bosing.
            </p>
          </div>
          
          <div className="flex justify-center pt-4">
            <NewMessageDialog 
              locale={locale} 
              trigger={(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="group inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
                >
                  <MessageSquare className="h-4.5 w-4.5 transition-transform group-hover:scale-110" />
                  Yangi suhbat boshlash
                </button>
              )}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
