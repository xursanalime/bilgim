'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser, Pencil, Trash2, Download } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRoomContext } from '@livekit/components-react';

const WHITEBOARD_TOPIC = 'whiteboard';
const COLORS = ['#0071E3', '#FF3B30', '#34C759', '#FF9500', '#000000', '#FFFFFF'];

type Tool = 'pencil' | 'eraser';

interface DrawEvent {
  topic: string;
  type: 'move' | 'begin' | 'end' | 'clear';
  x?: number;
  y?: number;
  color?: string;
  width?: number;
}

export function Whiteboard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const room = useRoomContext();

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#0071E3');
  const [strokeWidth, setStrokeWidth] = useState(3);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      // Preserve drawing on resize
      const tmp = canvas.toDataURL();
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctxRef.current = ctx;
      // Restore
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = tmp;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, []);

  // Publish draw event via LiveKit DataChannel
  const publish = useCallback((event: DrawEvent) => {
    if (!room?.localParticipant) return;
    try {
      const data = new TextEncoder().encode(JSON.stringify(event));
      room.localParticipant.publishData(data, { reliable: true });
    } catch {}
  }, [room]);

  // Apply a draw event to the canvas
  const applyEvent = useCallback((ev: DrawEvent) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    if (ev.type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (ev.type === 'begin') {
      ctx.beginPath();
      ctx.moveTo(ev.x!, ev.y!);
      ctx.strokeStyle = ev.color!;
      ctx.lineWidth = ev.width!;
      return;
    }
    if (ev.type === 'move') {
      ctx.strokeStyle = ev.color!;
      ctx.lineWidth = ev.width!;
      ctx.lineTo(ev.x!, ev.y!);
      ctx.stroke();
      return;
    }
    if (ev.type === 'end') {
      ctx.closePath();
    }
  }, []);

  // Receive remote whiteboard events
  useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array, participant?: any) => {
      // Ignore own publishes (livekit may echo them)
      if (participant?.isLocal) return;
      try {
        const ev: DrawEvent = JSON.parse(new TextDecoder().decode(payload));
        if (ev.topic !== WHITEBOARD_TOPIC) return;
        applyEvent(ev);
      } catch {}
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room, applyEvent]);

  // --- Mouse / Touch handlers ---
  const getPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0];
      if (!t) return { x: 0, y: 0 };
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const effectiveColor = tool === 'eraser' ? '#FFFFFF' : color;
  const effectiveWidth = tool === 'eraser' ? 20 : strokeWidth;

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const { x, y } = getPos(e);
    const ev: DrawEvent = { topic: WHITEBOARD_TOPIC, type: 'begin', x, y, color: effectiveColor, width: effectiveWidth };
    applyEvent(ev);
    publish(ev);
  };

  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const { x, y } = getPos(e);
    const ev: DrawEvent = { topic: WHITEBOARD_TOPIC, type: 'move', x, y, color: effectiveColor, width: effectiveWidth };
    applyEvent(ev);
    publish(ev);
  };

  const onPointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const ev: DrawEvent = { topic: WHITEBOARD_TOPIC, type: 'end' };
    applyEvent(ev);
    publish(ev);
  };

  const clearCanvas = () => {
    const ev: DrawEvent = { topic: WHITEBOARD_TOPIC, type: 'clear' };
    applyEvent(ev);
    publish(ev);
  };

  const downloadCanvas = () => {
    const link = document.createElement('a');
    link.download = 'doska.png';
    link.href = canvasRef.current?.toDataURL() ?? '';
    link.click();
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-gray-50 shrink-0 flex-wrap">
        <ToolBtn active={tool === 'pencil'} onClick={() => setTool('pencil')} icon={Pencil} />
        <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} icon={Eraser} />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Colors */}
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => { setColor(c); setTool('pencil'); }}
            style={{ backgroundColor: c }}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-transform',
              color === c && tool === 'pencil' ? 'scale-125 border-blue ring-2 ring-blue/30' : 'border-gray-300 hover:scale-110'
            )}
          />
        ))}

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Stroke width */}
        <div className="flex items-center gap-2">
          <input
            type="range" min={1} max={16} value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="w-20 accent-blue h-1"
          />
          <span className="text-[10px] text-gray-400 font-bold w-5">{strokeWidth}</span>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <button onClick={clearCanvas} title="Tozalash" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-all">
          <Trash2 className="h-4 w-4" />
        </button>
        <button onClick={downloadCanvas} title="Yuklab olish" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-all">
          <Download className="h-4 w-4" />
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden" style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: any }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-2 rounded-xl transition-all active:scale-90',
        active ? 'bg-blue text-white shadow-md shadow-blue/20' : 'text-gray-500 hover:bg-gray-100'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
