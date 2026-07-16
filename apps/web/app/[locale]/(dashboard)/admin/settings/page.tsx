'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  Loader2,
  RotateCcw,
  ShieldQuestion,
  SlidersHorizontal,
} from 'lucide-react';

import { adminApi, type AdminSystemSetting } from '../../../../../lib/api/admin';
import {
  SYSTEM_SETTINGS_SECTIONS,
  REGISTERED_SETTING_KEYS,
  coerceSettingValue,
  type SettingField,
  type SettingValue,
} from '../../../../../lib/admin/system-settings-schema';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Switch } from '../../../../../components/ui/switch';
import { Card } from '../../../../../components/ui/card';
import { toast } from '../../../../../components/ui/toast';

// ═════════════════════════════════════════════════════════════════
// Admin → Tizim Sozlamalari
//
// A typed, no-JSON management surface over the generic `SystemSetting`
// key/value store. Well-known settings (see system-settings-schema.ts)
// render as proper controls grouped into sections; any other stored keys
// are listed read-only under "Boshqa sozlamalar".
// ═════════════════════════════════════════════════════════════════

type DraftMap = Record<string, SettingValue>;

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin', 'system-settings'],
    queryFn: () => adminApi.listSystemSettings(),
  });

  // Map stored settings by key for quick lookup.
  const storedByKey = useMemo(() => {
    const map = new Map<string, AdminSystemSetting>();
    (settings ?? []).forEach((s) => map.set(s.key, s));
    return map;
  }, [settings]);

  // The persisted (coerced) value for a registered field.
  const persistedValue = (field: SettingField): SettingValue =>
    coerceSettingValue(field, storedByKey.get(field.key)?.value);

  // Local draft holds only edited fields; merged with persisted on render.
  const [draft, setDraft] = useState<DraftMap>({});

  const currentValue = (field: SettingField): SettingValue =>
    field.key in draft ? draft[field.key]! : persistedValue(field);

  const setFieldValue = (field: SettingField, value: SettingValue) => {
    setDraft((prev) => {
      const next = { ...prev };
      // If the new value equals the persisted one, drop it from the draft.
      if (value === persistedValue(field)) {
        delete next[field.key];
      } else {
        next[field.key] = value;
      }
      return next;
    });
  };

  const dirtyKeys = Object.keys(draft);
  const isDirty = dirtyKeys.length > 0;

  const saveMutation = useMutation({
    mutationFn: async (entries: DraftMap) => {
      // Persist each changed key. Sequential keeps the audit log readable
      // and avoids hammering the idempotency cache.
      for (const [key, value] of Object.entries(entries)) {
        const field = findField(key);
        const description = field?.description;
        await adminApi.updateSystemSetting(
          key,
          value,
          description,
          crypto.randomUUID(),
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'system-settings'] });
      setDraft({});
      toast.success('Sozlamalar saqlandi');
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Xatolik yuz berdi';
      toast.error(message);
    },
  });

  // Settings stored on the backend but not part of the typed registry.
  const advancedSettings = (settings ?? []).filter(
    (s) => !REGISTERED_SETTING_KEYS.has(s.key),
  );

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue" aria-hidden="true" />
        <span className="sr-only">Yuklanmoqda…</span>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-28">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">
            Tizim Sozlamalari
          </h1>
          <p className="mt-1.5 text-ink-soft">
            Platforma global parametrlarini kod yozmasdan boshqarish.
          </p>
        </div>
        {isDirty && (
          <span className="rounded-full bg-orange-tint px-4 py-1.5 text-xs font-bold text-orange">
            {dirtyKeys.length} ta o‘zgarish saqlanmagan
          </span>
        )}
      </header>

      <div className="space-y-8">
        {SYSTEM_SETTINGS_SECTIONS.map((section) => (
          <Card key={section.id} padding="lg" className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-tint text-blue">
                <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-ink-strong">
                  {section.title}
                </h2>
                <p className="text-sm text-ink-soft">{section.description}</p>
              </div>
            </div>

            <div className="divide-y divide-rim">
              {section.fields.map((field) => (
                <div
                  key={field.key}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                >
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={field.key}
                      className="flex items-center gap-2 text-sm font-bold text-ink-strong"
                    >
                      {field.label}
                      {field.key in draft && (
                        <span className="h-2 w-2 rounded-full bg-orange" aria-hidden="true" />
                      )}
                    </label>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {field.description}
                    </p>
                  </div>
                  <div className="shrink-0 sm:w-64">
                    <FieldControl
                      field={field}
                      value={currentValue(field)}
                      onChange={(v) => setFieldValue(field, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}

        {/* Advanced / externally-managed raw settings */}
        {advancedSettings.length > 0 && (
          <Card padding="lg" className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-ink-soft">
                <ShieldQuestion className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-ink-strong">
                  Boshqa sozlamalar
                </h2>
                <p className="text-sm text-ink-soft">
                  Boshqa ekranlarda boshqariladigan yoki maxsus sozlamalar
                  (faqat ko‘rish uchun).
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {advancedSettings.map((setting) => (
                <div
                  key={setting.key}
                  className="rounded-2xl border border-rim bg-tint/40 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="rounded-lg bg-tint px-2 py-1 text-xs font-bold text-blue">
                      {setting.key}
                    </code>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                      {new Date(setting.updatedAt).toLocaleString('uz-UZ')}
                    </span>
                  </div>
                  {setting.description && (
                    <p className="mt-2 text-xs text-ink-soft">
                      {setting.description}
                    </p>
                  )}
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-ink-strong/5 p-3 text-xs text-ink-strong">
                    {JSON.stringify(setting.value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Sticky save bar — appears when there are unsaved edits */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rim bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
            <p className="text-sm font-medium text-ink-soft">
              <span className="font-black text-ink-strong">
                {dirtyKeys.length} ta
              </span>{' '}
              sozlama o‘zgartirildi.
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setDraft({})}
                disabled={saveMutation.isPending}
              >
                Bekor qilish
              </Button>
              <Button
                leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate(draft)}
              >
                Saqlash
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function findField(key: string): SettingField | undefined {
  for (const section of SYSTEM_SETTINGS_SECTIONS) {
    const f = section.fields.find((field) => field.key === key);
    if (f) return f;
  }
  return undefined;
}

interface FieldControlProps {
  field: SettingField;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
}

function FieldControl({ field, value, onChange }: FieldControlProps) {
  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-3 sm:justify-end">
          <span className="text-sm font-bold text-ink-soft">
            {value ? 'Yoqilgan' : "O‘chirilgan"}
          </span>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
            aria-label={field.label}
          />
        </div>
      );
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            id={field.key}
            type="number"
            inputSize="sm"
            value={String(value)}
            min={field.min}
            max={field.max}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(Number.isFinite(n) ? n : field.defaultValue);
            }}
          />
          {field.unit && (
            <span className="shrink-0 text-xs font-bold text-ink-faint">
              {field.unit}
            </span>
          )}
        </div>
      );
    case 'select':
      return (
        <Select
          id={field.key}
          selectSize="sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      );
    case 'text':
    default:
      return (
        <Input
          id={field.key}
          type="text"
          inputSize="sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
