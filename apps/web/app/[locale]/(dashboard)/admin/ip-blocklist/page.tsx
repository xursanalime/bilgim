'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldOff,
  Loader2,
  RefreshCw,
  Info,
  Clock,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, AdminBlockedIp } from '../../../../../lib/api/admin';
import { ConfirmDialog } from '../../../../../components/ui/confirm-dialog';

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  honeypot: { label: 'Honeypot', className: 'bg-orange/10 text-orange border-orange/20' },
  threat_intel: { label: 'Threat Intel', className: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  manual: { label: "Qo'lda", className: 'bg-blue/10 text-blue border-blue/20' },
  brute_force: { label: 'Brute-force', className: 'bg-red/10 text-red border-red/20' },
};

function sourceBadge(source?: string) {
  if (source && SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return { label: source || "Noma'lum", className: 'bg-tint text-ink-soft border-rim' };
}

function formatExpiry(expiresAt?: number | null): string {
  if (!expiresAt) return 'Doimiy';
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return 'Muddati o\'tgan';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} daqiqadan keyin`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} soatdan keyin`;
  return `${Math.round(hours / 24)} kundan keyin`;
}

export default function AdminIpBlocklistPage() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AdminBlockedIp | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'ip-blocklist'],
    queryFn: () => adminApi.listBlockedIps({ limit: 200 }),
  });

  const unblockMutation = useMutation({
    mutationFn: (ip: string) => adminApi.unblockIp(ip, "Admin panelidan qo'lda ochildi", crypto.randomUUID()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ip-blocklist'] });
      toast.success(result.unblocked ? `${result.ip} bloklashdan chiqarildi` : `${result.ip} allaqachon bloklangan emas edi`);
      setTarget(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || error.message || 'Xatolik yuz berdi');
    },
  });

  const items = data?.blockedIps ?? [];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Bloklangan IP&apos;lar</h1>
          <p className="mt-1 text-ink-soft">
            Shubhali faoliyat tufayli bloklangan manzillar — bu yerdan qo&apos;lda ochish mumkin.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-5 py-3 text-sm font-black text-ink-soft transition-all hover:bg-tint disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-blue/20 bg-blue/5 p-5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
        <p className="text-sm leading-relaxed text-ink-soft">
          Har bir brauzer so&apos;rovi saytning proksi serveri orqali API&apos;ga boradi, shuning uchun bitta
          foydalanuvchining shubhali faoliyati butun platforma umumiy manzilini bloklab, boshqa barcha
          foydalanuvchilarni ham to&apos;xtatib qo&apos;yishi mumkin (&quot;This network has been blocked due to
          suspicious activity&quot;). Agar bir nechta foydalanuvchi birdan shikoyat qilsa, ehtimol shu holat —
          quyidagi ro&apos;yxatdan mos yozuvni oching.
        </p>
      </div>

      <div className="overflow-hidden rounded-[2.5rem] border border-rim bg-white p-2 shadow-sm">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-rim text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint">
              <th className="px-6 py-5">IP manzil</th>
              <th className="px-6 py-5">Sabab</th>
              <th className="px-6 py-5">Manba</th>
              <th className="px-6 py-5">Muddati</th>
              <th className="px-6 py-5 text-right">Amal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rim text-sm">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-20 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-24">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-tint text-ink-faint">
                      <ShieldOff className="h-8 w-8" />
                    </div>
                    <h3 className="text-xl font-black text-ink-strong">Bloklangan IP yo&apos;q</h3>
                    <p className="mt-2 max-w-xs text-ink-soft">Hozircha hech qanday manzil bloklanmagan.</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((entry) => {
                const badge = sourceBadge(entry.source);
                return (
                  <tr key={entry.ip} className="group transition-colors hover:bg-tint/30">
                    <td className="px-6 py-5 font-mono text-sm font-black text-ink-strong">{entry.ip}</td>
                    <td className="max-w-xs px-6 py-5 text-xs font-medium text-ink-soft">
                      {entry.reason || '—'}
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-black ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                        <Clock className="h-3.5 w-3.5 text-ink-faint" />
                        {formatExpiry(entry.expiresAt)}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <button
                        onClick={() => setTarget(entry)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-red/10 px-3.5 py-2 text-[11px] font-black uppercase tracking-widest text-red transition-colors hover:bg-red/20"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        Ochish
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={target !== null}
        title="IP manzilni bloklashdan chiqarish"
        message={target ? `${target.ip} manzilini bloklashdan chiqarasizmi? U qayta shubhali faoliyat ko'rsatsa, tizim uni avtomatik qayta bloklashi mumkin.` : ''}
        confirmLabel="Ha, ochish"
        cancelLabel="Bekor qilish"
        tone="danger"
        onConfirm={() => target && unblockMutation.mutate(target.ip)}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
