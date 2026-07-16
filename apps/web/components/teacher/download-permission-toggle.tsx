'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Download, Loader2, ShieldCheck } from 'lucide-react';

import { Switch } from '../ui/switch';
import { groupsApi } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// DownloadPermissionToggle — per-group Download_Permission control
// (Content Protection Req 4.5 / Req 2.1).
//
// `downloadAllowed` is **server-authoritative**: the API persists the
// value and reads it back, so the client never asserts it. We render the
// current value, flip optimistically for a snappy feel, and roll back on
// error. When disabled, students may only stream materials through the
// protected viewer; when enabled, entitled students may download them.
// ═════════════════════════════════════════════════════════════════

interface DownloadPermissionToggleProps {
  groupId: string;
  /** Current server-authoritative value, used as the initial UI state. */
  initialDownloadAllowed: boolean;
}

export function DownloadPermissionToggle({
  groupId,
  initialDownloadAllowed,
}: DownloadPermissionToggleProps) {
  const queryClient = useQueryClient();
  const [downloadAllowed, setDownloadAllowed] = useState(
    initialDownloadAllowed,
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      groupsApi.setDownloadPermission(groupId, next),
    onSuccess: (group) => {
      // Trust the server-authoritative value read back from the DB.
      setDownloadAllowed(group.downloadAllowed);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: (err: unknown, attempted) => {
      // Roll back the optimistic flip.
      setDownloadAllowed(!attempted);
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Server bilan aloqa xatosi.',
      );
    },
  });

  function handleChange(next: boolean) {
    setDownloadAllowed(next); // optimistic
    setError(null);
    mutation.mutate(next);
  }

  const helperId = 'download-permission-helper';
  const errorId = 'download-permission-error';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border p-6 transition-all duration-300 sm:p-7',
        downloadAllowed
          ? 'border-blue/20 bg-white shadow-[0_8px_32px_-8px_rgba(0,113,227,0.08)]'
          : 'border-rim bg-tint/40',
      )}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors',
              downloadAllowed ? 'bg-blue/10 text-blue' : 'bg-ink-faint/10 text-ink-soft',
            )}
          >
            {downloadAllowed ? (
              <Download className="h-5 w-5" />
            ) : (
              <ShieldCheck className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <h4 className="text-[15px] font-bold text-ink-strong">
              Yuklab olishga ruxsat
            </h4>
            <p
              id={helperId}
              className="text-[12px] font-medium leading-relaxed text-ink-soft opacity-80"
            >
              {downloadAllowed
                ? 'O\u2018quvchilar dars materiallarini (PDF, audio, hujjat) yuklab olishlari mumkin.'
                : 'O\u2018quvchilar materiallarni faqat himoyalangan ko\u2018rinishda ko\u2018radi, yuklab ololmaydi.'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-1">
          {mutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />
          )}
          <Switch
            checked={downloadAllowed}
            onCheckedChange={handleChange}
            disabled={mutation.isPending}
            aria-label="Yuklab olishga ruxsat"
            aria-describedby={error ? errorId : helperId}
          />
        </div>
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-4 flex items-center gap-2 text-[11px] font-bold text-red"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
