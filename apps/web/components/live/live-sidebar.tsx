'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MessageSquare, Users, PenLine, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ChatTab } from './tabs/chat-tab';
import { LiveParticipantsTab } from './tabs/live-participants-tab';
import { Whiteboard } from './tabs/whiteboard-tab';

interface LiveSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'chat' | 'participants' | 'whiteboard';
  setActiveTab: (tab: 'chat' | 'participants' | 'whiteboard') => void;
  raisedHands: Set<string>;
  micGranted: Set<string>;
  isTeacher: boolean;
  onGrantMic: (identity: string, grant: boolean) => void;
}

const TAB_LABELS: Record<'chat' | 'participants' | 'whiteboard', string> = {
  chat: 'Chat',
  participants: 'Talabalar',
  whiteboard: 'Doska',
};

export function LiveSidebar({
  isOpen, onClose, activeTab, setActiveTab, raisedHands,
  micGranted, isTeacher, onGrantMic,
}: LiveSidebarProps) {
  const reduceMotion = useReducedMotion();
  const tablistRef = React.useRef<HTMLDivElement>(null);

  // Composite tablist: arrow keys move focus between tabs (Req 6.1). Uses a
  // roving model — focus the previous/next tab button and wrap at the edges.
  const onTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' &&
        e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const tabs = tablistRef.current
      ? Array.from(tablistRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      : [];
    if (tabs.length === 0) return;
    const current = tabs.findIndex((t) => t === document.activeElement);
    e.preventDefault();
    let next: number;
    if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = tabs.length - 1;
    } else {
      const start = current < 0 ? 0 : current;
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      next = (start + delta + tabs.length) % tabs.length;
    }
    tabs[next]?.focus();
  };

  return (
    <motion.aside
      aria-label="Jonli dars paneli"
      aria-hidden={!isOpen}
      initial={false}
      animate={{
        x: isOpen ? 0 : 420,
        opacity: isOpen ? 1 : 0,
      }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 220 }}
      className={cn(
        'w-[360px] shrink-0 h-full z-40',
        !isOpen && 'pointer-events-none'
      )}
    >
      <div className="flex flex-col h-full bg-canvas border border-rim rounded-2xl overflow-hidden shadow-medium">

        {/* Tab header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rim shrink-0">
          <div role="tablist" aria-label="Panel bo'limlari" ref={tablistRef} onKeyDown={onTablistKeyDown} className="flex bg-tint rounded-xl p-1 border border-rim gap-0.5">
            <TabBtn id="chat" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={MessageSquare} label={TAB_LABELS.chat} />
            <TabBtn
              id="participants"
              active={activeTab === 'participants'}
              onClick={() => setActiveTab('participants')}
              icon={Users}
              label={TAB_LABELS.participants}
              badge={raisedHands.size > 0 ? raisedHands.size : undefined}
            />
            <TabBtn id="whiteboard" active={activeTab === 'whiteboard'} onClick={() => setActiveTab('whiteboard')} icon={PenLine} label={TAB_LABELS.whiteboard} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Panelni yopish"
            tabIndex={isOpen ? 0 : -1}
            className="h-10 w-10 rounded-2xl hover:bg-tint flex items-center justify-center text-ink-soft outline-none hover:text-ink-strong focus-visible:ring-2 focus-visible:ring-blue transition-all group active:scale-90"
          >
            <X className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Content */}
        <div
          role="tabpanel"
          aria-label={TAB_LABELS[activeTab]}
          className="flex-1 overflow-hidden relative"
        >
          {activeTab === 'chat' && <ChatTab />}
          {activeTab === 'participants' && (
            <LiveParticipantsTab
              raisedHands={raisedHands}
              micGranted={micGranted}
              isTeacher={isTeacher}
              onGrantMic={onGrantMic}
            />
          )}
          {activeTab === 'whiteboard' && <Whiteboard />}
        </div>
      </div>
    </motion.aside>
  );
}

function TabBtn({
  active, onClick, icon: Icon, label, badge, id,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  badge?: number | undefined;
  id: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`live-tab-${id}`}
      aria-selected={active}
      aria-label={label}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold outline-none transition-all',
        'focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        active ? 'bg-blue text-white shadow-sm' : 'text-ink-soft hover:text-ink-strong hover:bg-tint'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active ? 'text-white' : 'text-inherit')} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      {badge != null && (
        <span
          className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange text-[8px] font-black text-white"
          aria-label={`${badge} qo'l ko'tarilgan`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
