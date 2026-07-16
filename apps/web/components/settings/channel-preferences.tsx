'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Mail,
  Send,
  Lock,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import {
  getChannelPreferences,
  setChannelEnabled,
  type ChannelPreferenceState,
  type ManagedChannel,
} from '../../lib/channel-preferences';
import { ApiClientError } from '../../lib/api-client';
import { LoadingState, ErrorState } from '../states';
import { cn } from '../../lib/utils';

/**
 * Channel-level notification preferences (Task 10.2, Req 14.5).
 *
 * Lets a user flip whole delivery channels (Email, Telegram) on or off
 * in a single action. The in-app channel is shown as a locked,
 * always-on row because the backend treats it as mandatory.
 *
 * This is the high-level summary counterpart to the per-kind matrix in
 * `components/notifications/notification-preferences.tsx`; both read and
 * write the same `/notifications/preferences` surface through TanStack
 * Query, so toggling here keeps the detailed grid in sync.
 */

const CHANNEL_ICONS: Record<ManagedChannel, typeof Bell> = {
  IN_APP: Bell,
  EMAIL: Mail,
  TELEGRAM: Send,
};

const PREFERENCES_KEY = ['notifications', 'preferences'] as const;

export function ChannelPreferences() {
  const queryClient = useQueryClient();
  const [pendingChannel, setPendingChannel] = useState<ManagedChannel | null>(
    null,
  );
  const [savedChannel, setSavedChannel] = useState<ManagedChannel | null>(null);

  const channelsQuery = useQuery({
    queryKey: [...PREFERENCES_KEY, 'channels'],
    queryFn: () => getChannelPreferences(),
  });

  const toggle = useMutation({
    mutationFn: ({
      channel,
      enabled,
    }: {
      channel: ManagedChannel;
      enabled: boolean;
    }) => setChannelEnabled(channel, enabled),
    onMutate: ({ channel }) => {
      setPendingChannel(channel);
      setSavedChannel(null);
    },
    onSuccess: (_data, { channel }) => {
      setSavedChannel(channel);
      // Refresh both this view and the per-kind matrix (shared surface).
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
    },
    onSettled: () => {
      setPendingChannel(null);
    },
  });

  const channels = channelsQuery.data ?? [];

  const errorMessage = useMemo(() => {
    if (!toggle.isError) return null;
    const err = toggle.error;
    if (err instanceof ApiClientError) return err.message;
    return err instanceof Error
      ? err.message
      : "Sozlamani saqlab bo'lmadi.";
  }, [toggle.isError, toggle.error]);

  if (channelsQuery.isLoading) {
    return <LoadingState variant="list" count={3} label="Yuklanmoqda…" />;
  }

  if (channelsQuery.isError) {
    return (
      <ErrorState
        title="Sozlamalarni yuklab bo'lmadi"
        message={
          channelsQuery.error instanceof ApiClientError
            ? channelsQuery.error.message
            : "Kanallarni yuklashda xatolik yuz berdi."
        }
        retryLabel="Qayta urinish"
        onRetry={() => channelsQuery.refetch()}
      />
    );
  }

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft sm:p-8">
        <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
          <Bell className="h-3.5 w-3.5" />
          Xabarnoma kanallari
        </div>
        <h2 className="mt-3 font-display text-xl font-extrabold tracking-tight text-ink-strong sm:text-2xl">
          Qaysi kanallar orqali xabar olasiz?
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
          Har bir kanalni butunlay yoqing yoki o'chiring. Batafsil sozlash
          uchun pastdagi xabarnoma turlari jadvalidan foydalaning.
        </p>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red/5 px-4 py-3 text-sm font-medium text-red"
        >
          {errorMessage}
        </div>
      ) : null}

      <ul className="space-y-3">
        {channels.map((channel) => (
          <ChannelRow
            key={channel.channel}
            state={channel}
            pending={pendingChannel === channel.channel && toggle.isPending}
            saved={savedChannel === channel.channel && !toggle.isPending}
            onToggle={(enabled) =>
              toggle.mutate({ channel: channel.channel, enabled })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function ChannelRow({
  state,
  pending,
  saved,
  onToggle,
}: {
  state: ChannelPreferenceState;
  pending: boolean;
  saved: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const Icon = CHANNEL_ICONS[state.channel];

  return (
    <li className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-rim bg-white p-5 shadow-soft transition-colors hover:border-blue/20">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border',
            state.enabled
              ? 'border-blue/10 bg-blue/5 text-blue'
              : 'border-rim bg-tint text-ink-faint',
          )}
        >
          <Icon className="h-5.5 w-5.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-display text-sm font-extrabold text-ink-strong">
              {state.label}
            </p>
            {state.locked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-faint">
                <Lock className="h-2.5 w-2.5" />
                Majburiy
              </span>
            ) : null}
            {saved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-strong">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Saqlandi
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs font-medium text-ink-soft">
            {state.description}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue" aria-hidden="true" />
        ) : null}
        <ToggleSwitch
          enabled={state.enabled}
          disabled={state.locked || pending}
          onChange={() => onToggle(!state.enabled)}
          aria-label={`${state.label} kanalini ${
            state.enabled ? "o'chirish" : 'yoqish'
          }`}
        />
      </div>
    </li>
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
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        enabled ? 'bg-blue' : 'bg-rim',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      )}
      {...rest}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          enabled ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
