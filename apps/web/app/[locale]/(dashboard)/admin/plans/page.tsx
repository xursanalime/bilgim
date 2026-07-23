'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Zap,
  Plus,
  CheckCircle2,
  CreditCard,
  Target,
  Users,
  Loader2,
} from 'lucide-react';
import { adminApi } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';

const STATUS_COLORS: Record<string, string> = {
  PAID: 'text-teal',
  PENDING: 'text-yellow-600',
  CANCELED: 'text-red',
  REFUNDED: 'text-orange',
};

export default function AdminPlansPage() {
  const { data: invoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ['admin', 'invoices', { limit: 5 }],
    queryFn: () => adminApi.listRecentInvoices({ limit: 5 }),
  });

  const { data: stats } = useQuery({
    queryKey: ['admin', 'system', 'stats'],
    queryFn: () => adminApi.getSystemStats(),
  });

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Tarif Rejalari</h1>
          <p className="mt-1 text-ink-soft">Sotuv paketlari va obuna shartlarini boshqarish.</p>
        </div>
        <button className="flex h-12 items-center gap-2 rounded-2xl bg-blue px-6 text-sm font-black text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:scale-[1.02] active:scale-[0.98]">
          <Plus className="h-4 w-4" />
          Yangi tarif
        </button>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Premium Plan Card */}
        <div className="rounded-[3rem] border-2 border-blue bg-white p-10 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 h-40 w-40 bg-blue/5 rounded-full -translate-y-10 translate-x-10 group-hover:scale-110 transition-transform" />
          <div className="absolute top-6 right-8 bg-blue text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">Ommabop</div>

          <div className="h-16 w-16 rounded-[2rem] bg-blue/10 flex items-center justify-center text-blue mb-8">
            <Zap className="h-8 w-8" />
          </div>

          <h3 className="text-2xl font-black text-ink-strong">Professional</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-black text-ink-strong">299,000</span>
            <span className="text-sm font-bold text-ink-soft italic">so&apos;m / oy</span>
          </div>

          <div className="mt-10 space-y-5">
            <FeatureItem label="Barcha mutaxassisliklar" />
            <FeatureItem label="Cheksiz AI Tutor yordami" />
            <FeatureItem label="Premium sertifikatlar" />
            <FeatureItem label="Shaxsiy mentor maslahati" />
            <FeatureItem label="Reklamasiz interfeys" />
          </div>

          <button className="mt-12 w-full h-14 rounded-2xl bg-blue text-white text-sm font-black uppercase tracking-widest shadow-lg shadow-blue/20 hover:shadow-blue/40 transition-all active:scale-95">
            Tahrirlash
          </button>
        </div>

        {/* Basic Plan Card */}
        <div className="rounded-[3rem] border border-rim bg-white p-10 shadow-sm relative group hover:border-blue/20 transition-all">
          <div className="h-16 w-16 rounded-[2rem] bg-tint flex items-center justify-center text-ink-soft mb-8 group-hover:bg-blue/5 group-hover:text-blue transition-colors">
            <Target className="h-8 w-8" />
          </div>

          <h3 className="text-2xl font-black text-ink-strong">Boshlang&apos;ich</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-black text-ink-strong">99,000</span>
            <span className="text-sm font-bold text-ink-soft italic">so&apos;m / oy</span>
          </div>

          <div className="mt-10 space-y-5 opacity-60">
            <FeatureItem label="Faqat bitta mutaxassislik" />
            <FeatureItem label="Cheklangan AI Tutor (60 ta/kun)" />
            <FeatureItem label="Standart sertifikatlar" />
            <FeatureItem disabled label="Shaxsiy mentor maslahati" />
            <FeatureItem label="Reklamasiz interfeys" />
          </div>

          <button className="mt-12 w-full h-14 rounded-2xl border border-rim bg-white text-ink-strong text-sm font-black uppercase tracking-widest hover:bg-tint transition-all active:scale-95">
            Tahrirlash
          </button>
        </div>

        {/* Statistics + Recent Invoices */}
        <div className="space-y-8">
          <div className="rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm">
            <h4 className="text-sm font-black text-ink-strong uppercase tracking-widest mb-6 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue" />
              Obunachilar tahlili
            </h4>
            <div className="space-y-6">
              <StatRow
                label="Jami foydalanuvchilar"
                value={stats?.totalUsers?.toLocaleString('uz-UZ') ?? '—'}
                color="blue"
              />
              <StatRow
                label="Faol o'qituvchilar"
                value={stats?.activeTeachers?.toLocaleString('uz-UZ') ?? '—'}
                color="ink"
              />
              <StatRow
                label="So'ngi 30 kundagi to'lovlar"
                value={stats?.paidInvoicesLast30Days?.toLocaleString('uz-UZ') ?? '—'}
                color="ink"
              />
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm">
            <h4 className="text-sm font-black text-ink-strong uppercase tracking-widest mb-6 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-teal" />
              Oxirgi to&apos;lovlar
            </h4>
            {loadingInvoices ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue" />
              </div>
            ) : !invoicesData?.items.length ? (
              <p className="text-center text-xs font-medium text-ink-faint py-6">Hali to'lovlar yo'q</p>
            ) : (
              <div className="space-y-4">
                {invoicesData.items.map((inv) => {
                  const name = inv.teacher?.user?.fullName ?? 'Noma\'lum';
                  const initials = name.charAt(0).toUpperCase();
                  const date = new Date(inv.issuedAt).toLocaleDateString('uz-UZ');
                  return (
                    <div key={inv.id} className="flex items-center justify-between group cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-xl bg-tint flex items-center justify-center text-[10px] font-black group-hover:bg-blue/10 group-hover:text-blue transition-colors">
                          {initials}
                        </div>
                        <div>
                          <p className="text-xs font-black text-ink-strong truncate max-w-[100px]">{name}</p>
                          <p className="text-[10px] font-medium text-ink-faint italic">{date}</p>
                        </div>
                      </div>
                      <span className={cn(
                        'text-xs font-black',
                        STATUS_COLORS[inv.status] ?? 'text-ink-strong'
                      )}>
                        +{(inv.amountUzs / 1000).toFixed(0)}k
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureItem({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', disabled && 'line-through text-ink-faint')}>
      <CheckCircle2 className={cn('h-4 w-4', disabled ? 'text-ink-faint' : 'text-blue')} />
      <span className="text-sm font-bold text-ink-strong">{label}</span>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-ink-soft">{label}</span>
      <span className={cn(
        'text-sm font-black tabular-nums',
        color === 'blue' ? 'text-blue' : color === 'red' ? 'text-red' : 'text-ink-strong'
      )}>
        {value}
      </span>
    </div>
  );
}
