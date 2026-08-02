'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Centered, platform-styled replacement for `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Tasdiqlash',
  cancelLabel = 'Bekor qilish',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-tint-strong/40 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm animate-in fade-in zoom-in-95 rounded-3xl border border-rim bg-white p-7 text-center shadow-soft duration-150">
        <div
          className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${
            tone === 'danger' ? 'bg-red-tint' : 'bg-blue-tint'
          }`}
        >
          <AlertTriangle
            className={`h-7 w-7 ${tone === 'danger' ? 'text-red' : 'text-blue'}`}
          />
        </div>
        <h2 className="text-lg font-black tracking-tight text-ink-strong">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</p>
        <div className="mt-7 flex gap-3">
          <Button variant="secondary" fullWidth onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            fullWidth
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
