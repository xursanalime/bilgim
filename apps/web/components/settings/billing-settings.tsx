'use client';

import { useQuery } from '@tanstack/react-query';
import { CreditCard, Receipt, Loader2, AlertCircle } from 'lucide-react';
import { billingApi } from '../../lib/api/billing';
import { cn } from '../../lib/utils';

const STATUS_LABELS: Record<string, string> = {
  PAID: "To'langan",
  PENDING: 'Kutilmoqda',
  CANCELED: 'Bekor qilingan',
  REFUNDED: 'Qaytarilgan',
};

const STATUS_COLORS: Record<string, string> = {
  PAID: 'bg-teal/10 text-teal',
  PENDING: 'bg-yellow-400/10 text-yellow-600',
  CANCELED: 'bg-red/10 text-red',
  REFUNDED: 'bg-orange/10 text-orange',
};

const KIND_LABELS: Record<string, string> = {
  STUDENT_COURSE: 'Kurs to\'lovi',
  TEACHER_SUBSCRIPTION: 'Obuna to\'lovi',
};

export function BillingSettings() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => billingApi.getMyInvoices({ limit: 20 }),
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-blue/5 text-blue border border-blue/10 sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
            <CreditCard className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-extrabold text-ink-strong sm:text-3xl">To'lovlar</h2>
            <p className="text-sm text-ink-soft opacity-80 max-w-md">
              To'lov tarixi va hisob-kitoblaringizni ko'ring.
            </p>
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-soft">
        <div className="border-b border-rim bg-tint/30 px-6 py-4">
          <h3 className="font-display text-base font-extrabold text-ink-strong flex items-center gap-2">
            <Receipt className="h-4.5 w-4.5 text-blue" />
            To'lovlar tarixi
          </h3>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red/5 text-red mb-4">
              <AlertCircle className="h-7 w-7" />
            </div>
            <p className="text-sm font-bold text-ink-soft">Ma'lumotlarni yuklashda xato yuz berdi</p>
          </div>
        ) : !data?.items.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-ink-faint mb-4">
              <Receipt className="h-7 w-7" />
            </div>
            <p className="text-base font-black text-ink-strong">Hech qanday to'lov topilmadi</p>
            <p className="text-sm font-medium text-ink-soft mt-1">Kurs yoki obuna sotib olgandan so'ng bu yerda ko'rinadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-sm">
              <thead className="border-b border-rim bg-tint/10">
                <tr>
                  <th className="px-6 py-4 text-left font-display text-[10px] font-extrabold uppercase tracking-wider text-ink-faint">ID</th>
                  <th className="px-4 py-4 text-left font-display text-[10px] font-extrabold uppercase tracking-wider text-ink-faint">Tur</th>
                  <th className="px-4 py-4 text-left font-display text-[10px] font-extrabold uppercase tracking-wider text-ink-faint">Sana</th>
                  <th className="px-4 py-4 text-left font-display text-[10px] font-extrabold uppercase tracking-wider text-ink-faint">Miqdor</th>
                  <th className="px-4 py-4 text-left font-display text-[10px] font-extrabold uppercase tracking-wider text-ink-faint">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rim">
                {data.items.map((inv) => (
                  <tr key={inv.id} className="transition-colors hover:bg-tint/20">
                    <td className="px-6 py-4 font-mono text-[11px] font-bold text-ink-strong truncate max-w-[120px]">
                      {inv.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-4 text-xs font-bold text-ink-soft">
                      {KIND_LABELS[inv.kind] ?? inv.kind}
                    </td>
                    <td className="px-4 py-4 text-xs text-ink-soft">
                      {new Date(inv.issuedAt).toLocaleDateString('uz-UZ')}
                    </td>
                    <td className="px-4 py-4 text-xs font-bold text-ink-strong">
                      {inv.amountUzs.toLocaleString('uz-UZ')} so'm
                    </td>
                    <td className="px-4 py-4">
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                        STATUS_COLORS[inv.status] ?? 'bg-tint text-ink-soft'
                      )}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
