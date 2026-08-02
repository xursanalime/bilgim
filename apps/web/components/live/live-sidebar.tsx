'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
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

export function LiveSidebar({
  isOpen, onClose, activeTab, setActiveTab, raisedHands,
  micGranted, isTeacher, onGrantMic,
}: LiveSidebarProps) {
  return (
    <motion.div
      initial={false}
      animate={{ x: isOpen ? '0%' : '100%', opacity: isOpen ? 1 : 0 }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className={cn(
        // Must match LiveRoom.tsx's <main> top/bottom padding — both
        // reserve space for the same floating LiveTopBar/LiveControlBar.
        'fixed top-[96px] bottom-[64px] right-2 z-40 w-[88vw] max-w-[360px]',
        'sm:top-[72px] sm:bottom-[80px]',
        'md:static md:top-auto md:bottom-auto md:right-auto md:h-full md:w-[360px] md:max-w-none md:shrink-0',
        !isOpen && 'pointer-events-none'
      )}
    >
      <div className="flex flex-col h-full bg-white border border-rim rounded-2xl overflow-hidden shadow-soft">

        {/* Tab header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rim shrink-0">
          <div className="flex bg-tint rounded-xl p-1 border border-rim gap-0.5">
            <TabBtn active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={MessageSquare} label="Chat" />
            <TabBtn
              active={activeTab === 'participants'}
              onClick={() => setActiveTab('participants')}
              icon={Users}
              label="Talabalar"
              badge={raisedHands.size > 0 ? raisedHands.size : undefined}
            />
            <TabBtn active={activeTab === 'whiteboard'} onClick={() => setActiveTab('whiteboard')} icon={PenLine} label="Doska" />
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-2xl hover:bg-tint flex items-center justify-center text-ink-faint hover:text-ink-strong transition-all group active:scale-90"
          >
            <X className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
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
    </motion.div>
  );
}

function TabBtn({
  active, onClick, icon: Icon, label, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  badge?: number | undefined;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all',
        active ? 'bg-white text-ink-strong shadow-sm' : 'text-ink-faint hover:text-ink-strong hover:bg-white/60'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active ? 'text-blue' : 'text-inherit')} />
      <span className="hidden sm:inline">{label}</span>
      {badge != null && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange text-[8px] font-black text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
