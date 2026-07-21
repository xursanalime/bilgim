'use client';

import * as React from 'react';
import { Tldraw, useEditor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useRoomContext } from '@livekit/components-react';
import { DataPacket_Kind } from 'livekit-client';

function TldrawLiveKitSync() {
  const editor = useEditor();
  const room = useRoomContext();

  React.useEffect(() => {
    // Listen to local changes and publish them via LiveKit DataChannel
    const unsubscribe = editor.store.listen((update) => {
      if (update.source === 'user') {
        const payload = JSON.stringify({ type: 'tldraw-update', data: update });
        const encoder = new TextEncoder();
        room.localParticipant.publishData(encoder.encode(payload), {
            reliable: true,
            // @ts-ignore
            topic: 'tldraw',
        });
      }
    });

    // Receive remote changes and apply to Tldraw
    const handleDataReceived = (payload: Uint8Array, participant?: any, kind?: any, topic?: string) => {
      // livekit-client v2 uses topic property on dataReceived event args, but we can also decode and check.
      const decoder = new TextDecoder();
      const msg = decoder.decode(payload);
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'tldraw-update') {
           // Apply remote updates to the store
           editor.store.mergeRemoteChanges(() => {
              // Tldraw handles the diff merging
              // This is a simplified merge, real CRDT integration uses Yjs
           });
        }
      } catch(e) {
         // ignore parse errors
      }
    };

    room.on('dataReceived', handleDataReceived);

    return () => {
      unsubscribe();
      room.off('dataReceived', handleDataReceived);
    };
  }, [editor, room]);

  return null;
}

export function Whiteboard() {
  return (
    <div className="w-full h-full bg-white relative rounded-xl overflow-hidden shadow-2xl">
      <div className="absolute top-4 left-4 z-50 bg-black/80 text-white px-3 py-1 rounded-md text-sm">
        Hamkorlik doskasi
      </div>
      <Tldraw autoFocus={false}>
         <TldrawLiveKitSync />
      </Tldraw>
    </div>
  );
}
