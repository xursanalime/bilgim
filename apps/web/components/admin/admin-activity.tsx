'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  UserPlus,
  CreditCard,
  Radio,
  ShieldAlert,
  Settings,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

import { adminApi, type AdminActivityItem } from '../../lib/api/admin';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { Card, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { LoadingState } from '../states/loading-state';
import { ErrorState } from '../states/error-state';
import { EmptyState } from '../states/empty-state';

/**
 * Admin recent-activity feed (task 13.1, Req 17.1).
 *
 * Reads the normalized `GET /admin/activity` feed via the typed
 * `adminApi.getRecentActivity` wrapper. Each entry maps to an icon/accent by
 * `type`. Loading / error / empty are handled with the shared state
 * primitives. Copy is localized in Uzbek (uz).
 */

interface ActivityVisual {
  icon: LucideIcon;
  /** Tailwind classes for the icon chip (tint background + text color). */
  chip: string;
}

const ACTIVITY_VISUALS: Record<AdminActivityItem['type'], ActivityVisual> = {
  user: { icon: UserPlus, chip: 'bg-blue-tint text-blue' },
  payment: { icon: CreditCard, chip: 'bg-green-tint text-green' },
  live: { icon: Radio, chip: 'bg-red-tint text-red' },
  moderation: { icon: ShieldAlert, chip: 'bg-orange-tint text-orange' },
  system: { icon: Settings, chip: 'bg-purple-tint text-purple' },
  other: { icon: Activity, chip: 'bg-tint text-ink-soft' },
};

const dateTimeFormatter = new Intl.DateTimeFormat('uz-UZ', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTimeFormatter.format(date);
}

interface AdminActivityProps {
  /** How many entries to request from the feed. */
  limit?: number;
}

export function AdminActivity({ limit = 8 }: AdminActivityProps) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'dashboard', 'activity', { limit }],
    queryFn: () => adminApi.getRecentActivity({ limit }),
  });

  const items = data?.items ?? [];

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <CardHeader className="pb-0">
        <CardTitle>So'nggi harakatlar</CardTitle>
        <CardDescription>Platformadagi eng so'nggi voqealar oqimi.</CardDescription>
      </CardHeader>

      {isLoading ? (
        <LoadingState variant="list" count={5} label="Harakatlar yuklanmoqda…" />
      ) : isError ? (
        <ErrorState
          icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
          title="Harakatlarni yuklab bo'lmadi"
          message={
            error instanceof ApiClientError
              ? error.message
              : "Harakatlar oqimini olishda xatolik yuz berdi."
          }
          retryLabel="Qayta urinish"
          onRetry={() => {
            void refetch();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden="true" />}
          title="Hozircha harakatlar yo'q"
          description="Platformada yangi voqealar sodir bo'lganda bu yerda ko'rinadi."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const visual = ACTIVITY_VISUALS[item.type] ?? ACTIVITY_VISUALS.other;
            const Icon = visual.icon;
            return (
              <li
                key={item.id}
                className="flex items-start gap-4 rounded-2xl border border-rim p-4"
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    visual.chip,
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-strong">
                    {item.title}
                  </p>
                  {item.description ? (
                    <p className="mt-0.5 truncate text-sm text-ink-soft">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <time
                  dateTime={item.createdAt}
                  className="shrink-0 text-xs font-medium text-ink-faint"
                >
                  {formatTimestamp(item.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
