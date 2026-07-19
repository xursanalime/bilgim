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
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: isOpen ? 0 : 420, opacity: isOpen ? 1 : 0 }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className={cn(
        'w-[360px] shrink-0 h-full z-40',
        !isOpen && 'pointer-events-none'
      )}
    >
      <div className="flex flex-col h-full bg-[#111118]/95 backdrop-blur-2xl border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/50">

        {/* Tab header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="flex bg-white/[0.06] rounded-xl p-1 border border-white/[0.06] gap-0.5">
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
            className="h-10 w-10 rounded-2xl hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all group active:scale-90"
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
        active ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white hover:bg-white/5'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active ? 'text-blue' : 'text-inherit')} />
      <span className="hidden sm:inline">{label}</span>
      {badge != null && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400 text-[8px] font-black text-black">
          {badge}
        </span>
      )}
    </button>
  );
}
