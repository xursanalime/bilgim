'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

import {
  notificationsApi,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNEL_LABELS_UZ,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPreference,
} from '../../lib/api/notifications';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

type MatrixKey = `${NotificationKind}:${NotificationChannel}`;

function key(kind: NotificationKind, channel: NotificationChannel): MatrixKey {
  return `${kind}:${channel}` as MatrixKey;
}

export function NotificationPreferences() {
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.getPreferences(),
  });

  const [edited, setEdited] = useState<Record<MatrixKey, boolean>>(
    {} as Record<MatrixKey, boolean>,
  );
  const [original, setOriginal] = useState<Record<MatrixKey, boolean>>(
    {} as Record<MatrixKey, boolean>,
  );

  useEffect(() => {
    if (!prefsQuery.data) return;
    const next: Record<MatrixKey, boolean> = {} as Record<MatrixKey, boolean>;
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        next[key(kind, channel)] = false;
      }
    }
    for (const row of prefsQuery.data) {
      next[key(row.kind, row.channel)] = row.enabled;
    }
    for (const kind of NOTIFICATION_KINDS) {
      next[key(kind, 'IN_APP')] = true;
    }
    setEdited(next);
    setOriginal(next);
  }, [prefsQuery.data]);

  const dirty = useMemo<NotificationPreference[]>(() => {
    const rows: NotificationPreference[] = [];
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        if (channel === 'IN_APP') continue;
        const k = key(kind, channel);
        if (edited[k] !== original[k]) {
          rows.push({ kind, channel, enabled: edited[k] === true });
        }
      }
    }
    return rows;
  }, [edited, original]);

  const save = useMutation({
    mutationFn: () => notificationsApi.bulkUpdatePreferences(dirty),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
  });

  function toggle(kind: NotificationKind, channel: NotificationChannel) {
    if (channel === 'IN_APP') return; 
    setEdited((prev) => ({
      ...prev,
      [key(kind, channel)]: !prev[key(kind, channel)],
    }));
  }

  if (prefsQuery.isLoading) {
    return <PreferencesSkeleton />;
  }

  if (prefsQuery.isError) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
        <AlertCircle className="h-5 w-5 shrink-0" />
        {prefsQuery.error instanceof ApiClientError
          ? prefsQuery.error.message
          : 'Sozlamalarni yuklashda xato yuz berdi.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <ShieldCheck className="h-3.5 w-3.5" />
              Xavfsizlik va xabarnomalar
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                Xabarnoma sozlamalari
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-ink-soft opacity-80">
                Oʻzingizga qulay boʻlgan xabarnoma kanallarini tanlang. Ilova ichidagi xabarlar doim yoqilgan boʻladi.
              </p>
            </div>
          </div>

          <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-blue/5 text-blue shadow-sm sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
            <Bell className="h-7 w-7 animate-pulse sm:h-8 sm:w-8" />
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft sm:rounded-[2.5rem]">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-sm">
            <thead className="border-b border-rim bg-tint/30">
              <tr>
                <th className="whitespace-nowrap px-6 py-4 text-left font-display text-[11px] font-extrabold uppercase tracking-wider text-ink-faint">
                  Xabarnoma turi
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th
                    key={channel}
                    className="px-6 py-4 text-center font-display text-[11px] font-extrabold uppercase tracking-wider text-ink-faint"
                  >
                    {NOTIFICATION_CHANNEL_LABELS_UZ[channel]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rim">
              {NOTIFICATION_KINDS.map((kind) => (
                <tr
                  key={kind}
                  className="transition-colors hover:bg-tint/20"
                >
                  <td className="whitespace-nowrap px-6 py-5 font-bold text-ink-strong">
                    {NOTIFICATION_KIND_LABELS_UZ[kind]}
                  </td>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const enabled = edited[key(kind, channel)] === true;
                    const locked = channel === 'IN_APP';
                    return (
                      <td
                        key={channel}
                        className="px-6 py-5 text-center"
                      >
                        <ToggleSwitch
                          enabled={enabled}
                          disabled={locked}
                          onChange={() => toggle(kind, channel)}
                          aria-label={`${NOTIFICATION_KIND_LABELS_UZ[kind]} – ${NOTIFICATION_CHANNEL_LABELS_UZ[channel]}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col-reverse items-center justify-between gap-6 rounded-[2rem] border border-rim bg-white p-5 shadow-soft sm:flex-row sm:p-4 sm:pl-8">
        <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start">
          <p className="text-sm font-medium text-ink-soft">
            {dirty.length === 0
              ? "O'zgartirish kiritilmagan"
              : <span className="font-bold text-orange">{dirty.length} ta o'zgartirish saqlanmagan</span>}
          </p>
          {save.isError && (
            <span className="flex items-center gap-1 text-xs font-bold text-red">
              <AlertCircle className="h-3.5 w-3.5" />
              Xatolik
            </span>
          )}
          {save.isSuccess && dirty.length === 0 && (
            <span className="flex items-center gap-1 rounded-full bg-teal-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-teal border border-teal/20">
              Muvaffaqiyatli saqlandi
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={dirty.length === 0 || save.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
        >
          {save.isPending ? (
            <><Loader2 className="h-4.5 w-4.5 animate-spin" /> Saqlanmoqda</>
          ) : (
            'Oʻzgarishlarni saqlash'
          )}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  disabled,
  onChange,
  ...rest
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: () => void;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        enabled ? "bg-blue" : "bg-rim",
        disabled ? "cursor-not-allowed opacity-50" : ""
      )}
      {...rest}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          enabled ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function PreferencesSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="h-40 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim shadow-soft" />
      <div className="h-96 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim shadow-soft" />
    </div>
  );
}
