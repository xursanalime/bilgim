/**
 * Channel-level notification preferences (Task 10.2, Req 14.5).
 *
 * The platform stores notification preferences as a `kind × channel`
 * matrix (see `lib/api/notifications.ts` and the NestJS
 * `notifications` module). This module layers a simpler *per-channel*
 * view on top of that matrix so users can flip an entire delivery
 * channel (Email, Telegram) on or off in one action, without touching
 * the per-kind grid.
 *
 * Backend assumptions (documented for the API contract):
 *   - GET  `/notifications/preferences` returns the full matrix as an
 *     array of `{ kind, channel, enabled }`. Rows that are absent are
 *     treated as their server default. We assume EMAIL/TELEGRAM default
 *     to disabled and IN_APP is always-on (the backend ignores attempts
 *     to disable IN_APP — it is a mandatory channel).
 *   - PATCH `/notifications/preferences` accepts `{ preferences: [...] }`
 *     and upserts each tuple, returning `{ updated, preferences }`.
 *   - A channel is considered "enabled" at the channel level when it is
 *     enabled for at least one notification kind. Toggling a channel
 *     writes the same `enabled` value across every kind so the per-kind
 *     grid and this summary view never disagree.
 *   - PUSH exists in the matrix but is intentionally excluded here; the
 *     web client surfaces only the channels the brief calls out
 *     (in-app, email, Telegram). Push remains editable via the detailed
 *     matrix.
 */

import {
  notificationsApi,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNEL_LABELS_UZ,
  type NotificationChannel,
  type NotificationPreference,
  type BulkUpdateResponse,
} from './api/notifications';

/** Channels surfaced in the channel-level UI, in display order. */
export const MANAGED_CHANNELS = ['IN_APP', 'EMAIL', 'TELEGRAM'] as const;
export type ManagedChannel = (typeof MANAGED_CHANNELS)[number];

/** IN_APP is mandatory and cannot be disabled (backend enforces this). */
export const LOCKED_CHANNELS: readonly ManagedChannel[] = ['IN_APP'];

/** Short Uzbek descriptions for each managed channel. */
export const CHANNEL_DESCRIPTIONS_UZ: Record<ManagedChannel, string> = {
  IN_APP: 'Bilgim ichidagi xabarnoma markazi. Doimo yoqilgan.',
  EMAIL: 'Muhim yangiliklar elektron pochtangizga yuboriladi.',
  TELEGRAM: 'Telegram bot orqali tezkor bildirishnomalar.',
};

export interface ChannelPreferenceState {
  channel: ManagedChannel;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;
}

/**
 * Reduce the preference matrix into per-channel on/off state. A channel
 * is "on" when enabled for at least one kind; IN_APP is always on.
 */
export function deriveChannelStates(
  preferences: NotificationPreference[],
): ChannelPreferenceState[] {
  const enabledByChannel = new Map<NotificationChannel, boolean>();
  for (const row of preferences) {
    if (row.enabled) enabledByChannel.set(row.channel, true);
  }

  return MANAGED_CHANNELS.map((channel) => {
    const locked = LOCKED_CHANNELS.includes(channel);
    return {
      channel,
      label: NOTIFICATION_CHANNEL_LABELS_UZ[channel],
      description: CHANNEL_DESCRIPTIONS_UZ[channel],
      enabled: locked ? true : enabledByChannel.get(channel) === true,
      locked,
    };
  });
}

/** GET — fetch the matrix and reduce it to channel-level state. */
export async function getChannelPreferences(): Promise<
  ChannelPreferenceState[]
> {
  const matrix = await notificationsApi.getPreferences();
  return deriveChannelStates(matrix);
}

/**
 * PATCH — flip an entire channel on/off by writing the value across
 * every notification kind. Throws for locked channels (IN_APP).
 */
export function setChannelEnabled(
  channel: ManagedChannel,
  enabled: boolean,
): Promise<BulkUpdateResponse> {
  if (LOCKED_CHANNELS.includes(channel)) {
    return Promise.reject(
      new Error(`${channel} kanalini o'chirib bo'lmaydi.`),
    );
  }
  const rows: NotificationPreference[] = NOTIFICATION_KINDS.map((kind) => ({
    kind,
    channel,
    enabled,
  }));
  return notificationsApi.bulkUpdatePreferences(rows);
}
