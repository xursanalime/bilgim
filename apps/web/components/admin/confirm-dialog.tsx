'use client';

import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

// ═════════════════════════════════════════════════════════════════
// ConfirmDialog (task 13.2, Req 17.3)
//
// A small, controlled confirmation modal built on the shared Dialog
// primitive. Every destructive admin action (suspend/ban a user, disable
// an English skill, delete an exam track / plan / prompt / CMS page) routes
// through this so the user must explicitly confirm. Focus-trap, Esc-to-close,
// scroll-lock and aria-modal come from the Dialog primitive.
// ═════════════════════════════════════════════════════════════════

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual treatment of the confirm button. */
  variant?: 'danger' | 'primary';
  /** Disables the confirm button + shows a busy state while the action runs. */
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Tasdiqlash',
  cancelLabel = 'Bekor qilish',
  variant = 'danger',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {variant === 'danger' ? (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red/10 text-red">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
            ) : null}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {description ? (
            <DialogDescription className="pt-1">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
