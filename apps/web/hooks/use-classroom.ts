'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';

export interface Participant {
  socketId: string;
  userId: string;
  role: 'TEACHER' | 'STUDENT';
  name: string;
  isMicOn: boolean;
  isCamOn: boolean;
  isHandRaised: boolean;
}

export interface WhiteboardData {
  type: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export function useClassroom(socket: Socket | null, lessonId: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'participants' | 'whiteboard'>('chat');
  const [whiteboardData, setWhiteboardData] = useState<WhiteboardData | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.on('classroom:participant-joined', (p: Participant) => {
      setParticipants(prev => {
        if (prev.find(x => x.socketId === p.socketId)) return prev;
        return [...prev, p];
      });
    });

    socket.on('classroom:participant-left', ({ socketId }: { socketId: string }) => {
      setParticipants(prev => prev.filter(p => p.socketId !== socketId));
    });

    socket.on('classroom:media-status-updated', ({ socketId, isMicOn, isCamOn }: any) => {
      setParticipants(prev => prev.map(p => 
        p.socketId === socketId ? { ...p, isMicOn: isMicOn ?? p.isMicOn, isCamOn: isCamOn ?? p.isCamOn } : p
      ));
    });

    socket.on('classroom:hand-raised', ({ socketId, isRaised }: any) => {
      setParticipants(prev => prev.map(p => 
        p.socketId === socketId ? { ...p, isHandRaised: isRaised } : p
      ));
    });

    socket.on('classroom:whiteboard-data', (data: WhiteboardData) => {
      setWhiteboardData(data);
    });

    socket.on('classroom:kicked', ({ reason }: { reason: string }) => {
      alert(reason);
      window.location.href = '/dashboard';
    });

    return () => {
      socket.off('classroom:participant-joined');
      socket.off('classroom:participant-left');
      socket.off('classroom:media-status-updated');
      socket.off('classroom:hand-raised');
      socket.off('classroom:whiteboard-data');
      socket.off('classroom:kicked');
    };
  }, [socket]);

  const updateMediaStatus = useCallback((isMicOn?: boolean, isCamOn?: boolean) => {
    socket?.emit('classroom:update-media-status', { lessonId, isMicOn, isCamOn });
  }, [socket, lessonId]);

  const raiseHand = useCallback((isRaised: boolean) => {
    setHandRaised(isRaised);
    socket?.emit('classroom:raise-hand', { lessonId, isRaised });
  }, [socket, lessonId]);

  const sendWhiteboardData = useCallback((data: WhiteboardData) => {
    socket?.emit('classroom:whiteboard-draw', { lessonId, data });
  }, [socket, lessonId]);

  const kickParticipant = useCallback((targetSocketId: string) => {
    socket?.emit('classroom:kick-participant', { lessonId, targetSocketId });
  }, [socket, lessonId]);

  return {
    participants,
    handRaised,
    isSidebarOpen,
    activeTab,
    whiteboardData,
    setIsSidebarOpen,
    setActiveTab,
    updateMediaStatus,
    raiseHand,
    sendWhiteboardData,
    kickParticipant,
    setParticipants,
  };
}
