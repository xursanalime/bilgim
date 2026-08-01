/**
 * How long after sending a message its author may still edit it.
 * Matches Telegram's own 48h edit window. Shared between DM and
 * group-chat services rather than duplicated per module.
 */
export const MESSAGE_EDIT_WINDOW_HOURS = 48;

/** `true` when `sentAt` is still inside the edit window, relative to `now` (defaults to `new Date()`). */
export function isWithinEditWindow(sentAt: Date, now: Date = new Date()): boolean {
  const windowMs = MESSAGE_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
  return now.getTime() - sentAt.getTime() <= windowMs;
}
