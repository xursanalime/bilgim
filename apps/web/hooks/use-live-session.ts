'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../lib/auth';

export type LiveRole = 'TEACHER' | 'STUDENT';

interface UseLiveSessionOptions {
  lessonId: string;
  role: LiveRole;
  name?: string;
  onJoinSuccess?: (data: any) => void;
}

export function useLiveSession({ lessonId, role, name, onJoinSuccess }: UseLiveSessionOptions): any {
  const [socket, setSocket] = useState<Socket | null>(null);
  const deviceRef = useRef<any>(null);
  const sendTransportRef = useRef<any>(null);
  const recvTransportRef = useRef<any>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [quality, setQuality] = useState<'360p' | '720p' | '1080p'>('720p');

  const updateRemoteStream = useCallback((producerId: string, stream: MediaStream | null) => {
    setRemoteStreams(prev => {
      const next = new Map(prev);
      if (stream) next.set(producerId, stream);
      else next.delete(producerId);
      return next;
    });
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setError('Sessiya topilmadi. Iltimos, qaytadan kiring.');
      return;
    }

    const newSocket = io('http://localhost:4000/live-sfu', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    newSocket.on('connect', () => {
      console.log('SFU Signaling connected');
      setIsConnected(true);
      setSocket(newSocket);
    });

    newSocket.on('connect_error', (err) => {
      console.error('SFU Connection error:', err);
      setError('Signaling serverga ulanib bo\u2018lmadi.');
    });

    newSocket.on('live:new-producer', async (data: { producerId: string; kind: string; appData?: any }) => {
      console.log('New producer in room:', data);
      if (recvTransportRef.current) {
        await consume(data.producerId);
      }
    });

    return () => {
      newSocket.disconnect();
      setSocket(null);
      [localStream, screenStream].forEach(s => s?.getTracks().forEach(t => t.stop()));
    };
  }, [lessonId]);

  const emitWithPromise = useCallback((event: string, payload: any) => {
    return new Promise((resolve, reject) => {
      if (!socket) return reject(new Error('Socket ulanmagan'));
      socket.emit(event, payload, (res: any) => {
        if (res && res.error) reject(new Error(res.error.message || 'Server xatosi'));
        else resolve(res);
      });
    });
  }, [socket]);

  const join = async () => {
    if (!socket) return;

    try {
      console.log('Joining room...');
      const data: any = await emitWithPromise('live:join', { lessonId, name });
      console.log('Join response data:', data);

      if (!data || !data.rtpCapabilities) {
        console.error('Invalid join response:', data);
        throw new Error('Serverdan RTP imkoniyatlari (capabilities) kelmadi.');
      }
      
      const { Device } = await import('mediasoup-client');
      const device = new Device();
      
      console.log('Loading device...');
      await device.load({ routerRtpCapabilities: data.rtpCapabilities });
      deviceRef.current = device;

      if (role === 'TEACHER') {
        await initSendTransport();
      }
      await initRecvTransport();

      if (data.producers && Array.isArray(data.producers)) {
        for (const p of data.producers) {
          await consume(p.producerId);
        }
      }

      onJoinSuccess?.(data);

    } catch (err: any) {
      console.error('Join process failed:', err);
      setError(err.message || 'Xonaga ulanib bo\u2018lmadi.');
    }
  };

  const initSendTransport = async () => {
    console.log('Creating send transport...');
    const info: any = await emitWithPromise('live:create-transport', { lessonId });
    const transport = deviceRef.current.createSendTransport(info);
    sendTransportRef.current = transport;

    transport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        await emitWithPromise('live:connect-transport', { 
          lessonId, 
          transportId: transport.id, 
          dtlsParameters 
        });
        callback();
      } catch (err) {
        errback(err);
      }
    });

    transport.on('produce', async ({ kind, rtpParameters, appData }: any, callback: any, errback: any) => {
      try {
        const res: any = await emitWithPromise('live:produce', {
          lessonId,
          transportId: transport.id,
          kind,
          rtpParameters,
          appData
        });
        callback({ id: res.id });
      } catch (err) {
        errback(err);
      }
    });
  };

  const initRecvTransport = async () => {
    console.log('Creating recv transport...');
    const info: any = await emitWithPromise('live:create-transport', { lessonId });
    const transport = deviceRef.current.createRecvTransport(info);
    recvTransportRef.current = transport;

    transport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        await emitWithPromise('live:connect-transport', { 
          lessonId, 
          transportId: transport.id, 
          dtlsParameters 
        });
        callback();
      } catch (err) {
        errback(err);
      }
    });
  };

  const consume = async (producerId: string) => {
    if (!recvTransportRef.current || !socket) return;

    try {
      console.log('Consuming producer:', producerId);
      const consumerInfo: any = await emitWithPromise('live:consume', {
        lessonId,
        transportId: recvTransportRef.current.id,
        producerId,
        rtpCapabilities: deviceRef.current.rtpCapabilities,
      });

      const consumer = await recvTransportRef.current.consume(consumerInfo);
      const stream = new MediaStream([consumer.track]);
      updateRemoteStream(producerId, stream);

      socket.emit('live:resume-consumer', { lessonId, consumerId: consumer.id });
    } catch (err) {
      console.error('Consume failed:', err);
    }
  };

  const toggleMedia = async (type: 'video' | 'audio', enable: boolean) => {
    if (!localStream) {
        if (enable) await startBroadcast();
        return;
    }
    localStream.getTracks().forEach(t => {
        if (t.kind === type) t.enabled = enable;
    });
  };

  const startBroadcast = async () => {
    if (role !== 'TEACHER' || !sendTransportRef.current) return;

    try {
      console.log('Starting local broadcast...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: true 
      });
      setLocalStream(stream);

      for (const track of stream.getTracks()) {
        await sendTransportRef.current.produce({ track });
      }
      console.log('Broadcast started successfully');
    } catch (err: any) {
      console.error('Camera/Mic access failed:', err);
      setError('Kamera yoki mikrofonga ruxsat berilmadi.');
    }
  };

  const shareScreen = async () => {
    if (role !== 'TEACHER' || !sendTransportRef.current) return;
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      setScreenStream(stream);
      const track = stream.getVideoTracks()[0];
      await sendTransportRef.current.produce({ track, appData: { type: 'screen' } });
      
      track.onended = () => {
        setScreenStream(null);
      };
    } catch (err) {
      console.error('Screen share failed:', err);
    }
  };

  return {
    isConnected,
    socket,
    error,
    localStream,
    screenStream,
    remoteStreams,
    quality,
    setQuality,
    join,
    toggleMedia,
    startBroadcast,
    shareScreen,
  };
}
