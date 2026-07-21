'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { groupsApi, type GroupModule } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface ModuleTogglePanelProps {
  groupId: string;
  initialModules: GroupModule[];
}

const MODULE_LABEL: Record<string, { label: string; hint: string }> = {
  WRITING: { label: 'Yozma ish', hint: 'Erkin yozish (insho, esse)' },
  READING: { label: 'O\u2018qish', hint: 'Matn + tarjima' },
  LISTENING: { label: 'Tinglash', hint: 'Audio + savollar' },
  GRAMMAR: { label: 'Grammatika', hint: 'Tilning qoidalari' },
  SPELLING: { label: 'Imlo', hint: 'So\u2018zlarni to\u2018g\u2018ri yozish' },
  VOCABULARY: { label: 'Lug\u2018at', hint: 'So\u2018z boyligi mashqi' },
  SPEAKING: { label: 'Gapirish', hint: 'Audio yozma topshiriqlar' },
  PRONUNCIATION: { label: 'Talaffuz', hint: 'Talaffuzni mashq qilish' },
  MULTIPLE_CHOICE: { label: 'Test (Multiple Choice)', hint: 'Variantlardan tanlash' },
  GAP_FILL: { label: 'Bo\u2018sh joyni to\u2018ldirish', hint: 'Tushib qolgan so\u2018zlar' },
  MATCHING: { label: 'Mos kelishi', hint: 'Juftlarni topish' },
  DRAG_DROP: { label: 'Drag & Drop', hint: 'Sudrab joylash' },
  PROJECT_SUBMISSION: { label: 'Proyekt', hint: 'Faylga yuklab topshirish' },
  CASE_STUDY: { label: 'Kase study', hint: 'Vaziyat tahlili' },
  MARKETING_COPY: { label: 'Marketing matni', hint: 'Reklama matni yozish' },
  AUDIENCE_ANALYSIS: { label: 'Auditoriya tahlili', hint: 'Maqsadli auditoriya' },
  CONTENT_CALENDAR: { label: 'Kontent kalendar', hint: 'Yo\u2018l xaritasi' },
  MATH_WORD_PROBLEM: { label: 'Matematik masala', hint: 'Hayotiy masala' },
  MATH_EQUATION_SOLVER: { label: 'Tenglama yechish', hint: 'Algebra' },
  MATH_GEOMETRY_PROOF: { label: 'Geometriya isboti', hint: 'Geometrik dalil' },
  CODE_REVIEW: { label: 'Kod tahlili', hint: 'Source code review' },
  CODE_UNIT_TEST: { label: 'Unit test yozish', hint: 'Avtomatlashtirilgan testlar' },
};

export function ModuleTogglePanel({
  groupId,
  initialModules,
}: ModuleTogglePanelProps) {
  const queryClient = useQueryClient();
  const [modules, setModules] = useState<GroupModule[]>(initialModules);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleMutation = useMutation({
    mutationFn: ({
      moduleType,
      isEnabled,
    }: {
      moduleType: string;
      isEnabled: boolean;
    }) => groupsApi.toggleModule(groupId, moduleType, isEnabled),
    onSuccess: (updated, variables) => {
      setModules((prev) =>
        prev.map((m) =>
          m.moduleType === variables.moduleType ? updated : m,
        ),
      );
      setErrors((prev) => {
        const next = { ...prev };
        delete next[variables.moduleType];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['group-modules', groupId] });
    },
    onError: (err: unknown, variables) => {
      // Roll back the optimistic state — re-fetch will sync if the network
      // failed mid-flight.
      setModules((prev) =>
        prev.map((m) =>
          m.moduleType === variables.moduleType
            ? { ...m, isEnabled: !variables.isEnabled }
            : m,
        ),
      );
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Server bilan aloqa xatosi.';
      setErrors((prev) => ({ ...prev, [variables.moduleType]: message }));
    },
  });

  function toggle(moduleType: string, current: boolean) {
    // Optimistic update: flip immediately so the UI feels instant.
    setModules((prev) =>
      prev.map((m) =>
        m.moduleType === moduleType ? { ...m, isEnabled: !current } : m,
      ),
    );
    toggleMutation.mutate({ moduleType, isEnabled: !current });
  }

  if (modules.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-rim bg-tint/30 p-12 text-center transition-colors hover:bg-tint/50">
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue/10 text-blue">
          <Loader2 className="h-8 w-8 opacity-20" />
        </div>
        <h3 className="font-display text-lg font-extrabold text-ink-strong">
          Modullar mavjud emas
        </h3>
        <p className="mt-1 max-w-xs text-sm text-ink-soft">
          Bu yo'nalish uchun birorta ham modul topilmadi. Iltimos, admin bilan bog'laning.
        </p>
      </div>
    );
  }

  const sorted = [...modules].sort((a, b) =>
    a.moduleType.localeCompare(b.moduleType),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.map((module) => {
        const meta = MODULE_LABEL[module.moduleType] ?? {
          label: module.moduleType,
          hint: '',
        };
        const error = errors[module.moduleType];
        const isPending =
          toggleMutation.isPending &&
          toggleMutation.variables?.moduleType === module.moduleType;
          
        return (
          <div
            key={module.id}
            className={cn(
              "group relative flex flex-col justify-between overflow-hidden rounded-3xl border p-5 transition-all duration-300",
              module.isEnabled 
                ? "border-blue/20 bg-white shadow-[0_8px_32px_-8px_rgba(0,113,227,0.08)]" 
                : "border-rim bg-tint/40 opacity-70 grayscale-[0.5] hover:opacity-100 hover:grayscale-0"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <h4 className="text-[15px] font-bold text-ink-strong transition-colors group-hover:text-blue">
                  {meta.label}
                </h4>
                {meta.hint && (
                  <p className="text-[11px] font-medium leading-relaxed text-ink-soft opacity-70">
                    {meta.hint}
                  </p>
                )}
              </div>
              
              <button
                type="button"
                onClick={() => toggle(module.moduleType, module.isEnabled)}
                disabled={isPending}
                aria-pressed={module.isEnabled}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full outline-none transition-all focus:ring-4 focus:ring-blue/10 disabled:cursor-not-allowed',
                  module.isEnabled ? 'bg-blue' : 'bg-ink-faint/20',
                  isPending && 'opacity-50'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-spring',
                    module.isEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
                  )}
                />
                {isPending && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-3 w-3 animate-spin text-white" />
                  </div>
                )}
              </button>
            </div>
            
            {error && (
              <p className="mt-3 text-[10px] font-bold text-red animate-in fade-in slide-in-from-top-1 duration-200">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
