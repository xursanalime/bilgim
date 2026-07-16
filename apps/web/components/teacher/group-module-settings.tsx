'use client';

import { useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Switch } from '../ui/switch';
import { EmptyState } from '../states';
import { groupsApi, type GroupModule } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { DownloadPermissionToggle } from './download-permission-toggle';

// ═════════════════════════════════════════════════════════════════
// GroupModuleSettings — teacher-facing group settings surface (Task 4.6).
//
// Composes two server-authoritative controls for a group:
//   1. The Download_Permission toggle (Req 2.1 — see DownloadPermissionToggle).
//   2. Homework module toggles for the 8 English language skills (Req 8.6).
//
// Bilgim is English-only, so the homework modules are exactly the 8 skills
// below. Toggles flip optimistically through the TanStack Query cache and
// roll back on error. Module state is sourced from `groupsApi.listModules`
// and persisted via `groupsApi.toggleModule`.
// ═════════════════════════════════════════════════════════════════

/** The 8 English language skills, in display order (Req 8.6). */
const ENGLISH_SKILLS = [
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'VOCABULARY',
  'SPELLING',
  'SPEAKING',
  'PRONUNCIATION',
] as const;

const SKILL_META: Record<
  (typeof ENGLISH_SKILLS)[number],
  { label: string; hint: string }
> = {
  WRITING: { label: 'Yozma ish', hint: 'Erkin yozish (insho, esse)' },
  READING: { label: 'O\u2018qish', hint: 'Matn + tushunish savollari' },
  LISTENING: { label: 'Tinglash', hint: 'Audio + savollar' },
  GRAMMAR: { label: 'Grammatika', hint: 'Tilning qoidalari' },
  VOCABULARY: { label: 'Lug\u2018at', hint: 'So\u2018z boyligi mashqi' },
  SPELLING: { label: 'Imlo', hint: 'So\u2018zlarni to\u2018g\u2018ri yozish' },
  SPEAKING: { label: 'Gapirish', hint: 'Audio yozma topshiriqlar' },
  PRONUNCIATION: { label: 'Talaffuz', hint: 'Talaffuzni mashq qilish' },
};

interface GroupModuleSettingsProps {
  groupId: string;
  /** Modules fetched server-side; seeds the TanStack Query cache. */
  initialModules: GroupModule[];
  /** Current server-authoritative Download_Permission value. */
  initialDownloadAllowed: boolean;
}

export function GroupModuleSettings({
  groupId,
  initialModules,
  initialDownloadAllowed,
}: GroupModuleSettingsProps) {
  const queryClient = useQueryClient();
  const queryKey = ['group-modules', groupId] as const;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: modules = [] } = useQuery({
    queryKey,
    queryFn: () => groupsApi.listModules(groupId),
    initialData: initialModules,
  });

  const toggleMutation = useMutation({
    mutationFn: ({
      moduleType,
      isEnabled,
    }: {
      moduleType: string;
      isEnabled: boolean;
    }) => groupsApi.toggleModule(groupId, moduleType, isEnabled),
    // Optimistic: flip the cached module immediately.
    onMutate: async ({ moduleType, isEnabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<GroupModule[]>(queryKey);
      queryClient.setQueryData<GroupModule[]>(queryKey, (prev) =>
        (prev ?? []).map((m) =>
          m.moduleType === moduleType ? { ...m, isEnabled } : m,
        ),
      );
      setErrors((prev) => {
        const next = { ...prev };
        delete next[moduleType];
        return next;
      });
      return { previous };
    },
    onError: (err: unknown, variables, context) => {
      // Roll back to the pre-mutation snapshot.
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Server bilan aloqa xatosi.';
      setErrors((prev) => ({ ...prev, [variables.moduleType]: message }));
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<GroupModule[]>(queryKey, (prev) =>
        (prev ?? []).map((m) =>
          m.moduleType === variables.moduleType ? updated : m,
        ),
      );
    },
  });

  // Only the 8 English skills, in canonical order. Falls back to a disabled
  // placeholder for any skill the backend hasn't provisioned yet.
  const skillModules = useMemo(() => {
    const byType = new Map(modules.map((m) => [m.moduleType, m]));
    return ENGLISH_SKILLS.map((skill) => ({
      moduleType: skill,
      module: byType.get(skill) ?? null,
    }));
  }, [modules]);

  const hasAnySkill = skillModules.some((s) => s.module !== null);

  function toggle(moduleType: string, current: boolean) {
    toggleMutation.mutate({ moduleType, isEnabled: !current });
  }

  return (
    <div className="space-y-8">
      {/* Download_Permission (Req 2.1) */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold text-ink-strong">
          Kontent himoyasi
        </h2>
        <DownloadPermissionToggle
          groupId={groupId}
          initialDownloadAllowed={initialDownloadAllowed}
        />
      </section>

      {/* Homework module toggles — the 8 English skills (Req 8.6) */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold text-ink-strong">
          Vazifa modullari
        </h2>

        {!hasAnySkill ? (
          <EmptyState
            title="Modullar mavjud emas"
            description={
              'Bu guruh uchun til ko\u2018nikmasi modullari topilmadi. ' +
              'Iltimos, admin bilan bog\u2018laning.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {skillModules.map(({ moduleType, module }) => {
              const meta = SKILL_META[moduleType as (typeof ENGLISH_SKILLS)[number]];
              const enabled = module?.isEnabled ?? false;
              const provisioned = module !== null;
              const error = errors[moduleType];
              const isPending =
                toggleMutation.isPending &&
                toggleMutation.variables?.moduleType === moduleType;

              return (
                <div
                  key={moduleType}
                  className={cn(
                    'group relative flex flex-col justify-between overflow-hidden rounded-3xl border p-5 transition-all duration-300',
                    !provisioned
                      ? 'border-dashed border-rim bg-tint/30 opacity-60'
                      : enabled
                        ? 'border-blue/20 bg-white shadow-[0_8px_32px_-8px_rgba(0,113,227,0.08)]'
                        : 'border-rim bg-tint/40 opacity-70 hover:opacity-100',
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <h4 className="text-[15px] font-bold text-ink-strong transition-colors group-hover:text-blue">
                        {meta.label}
                      </h4>
                      <p className="text-[11px] font-medium leading-relaxed text-ink-soft opacity-70">
                        {meta.hint}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      {isPending && (
                        <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />
                      )}
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => toggle(moduleType, enabled)}
                        disabled={!provisioned || isPending}
                        aria-label={meta.label}
                      />
                    </div>
                  </div>

                  {error && (
                    <p
                      role="alert"
                      className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-red"
                    >
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
