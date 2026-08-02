'use client';

import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  BookOpen, 
  ShieldCheck, 
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Clock,
  GraduationCap
} from 'lucide-react';
import { adminApi } from '../../../../lib/api/admin';
import { cn } from '../../../../lib/utils';
import Link from 'next/link';

export default function AdminDashboardPage({ params }: { params: { locale: string } }) {
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin', 'users', { limit: 1 }],
    queryFn: () => adminApi.listUsers({ limit: 1 }),
  });

  const { data: specialtiesData, isLoading: loadingSpecialties } = useQuery({
    queryKey: ['admin', 'specialties'],
    queryFn: () => adminApi.listSpecialties(),
  });

  const { data: auditData, isLoading: loadingAudit } = useQuery({
    queryKey: ['admin', 'audit-logs', { limit: 5 }],
    queryFn: () => adminApi.listAuditLogs({ limit: 5 }),
  });

  const { data: systemStats } = useQuery({
    queryKey: ['admin', 'system', 'stats'],
    queryFn: () => adminApi.getSystemStats(),
  });

  const stats = [
    {
      label: 'Jami foydalanuvchilar',
      value: systemStats?.totalUsers || 0,
      icon: Users,
      trend: '+12%',
      trendUp: true,
      color: 'blue',
    },
    {
      label: "O'qituvchilar",
      value: systemStats?.activeTeachers || 0,
      icon: GraduationCap,
      trend: '+2',
      trendUp: true,
      color: 'green',
    },
    {
      label: 'Oxirgi 30 kunlik tushum',
      value: systemStats?.paidInvoicesLast30Days || 0,
      icon: TrendingUp,
      trend: 'Barqaror',
      trendUp: true,
      color: 'purple',
    },
    {
      label: "Kutilayotgan so'rovlar",
      value: systemStats?.pendingEnrollmentRequests || 0,
      icon: Clock,
      trend: 'Tezkor',
      trendUp: true,
      color: 'orange',
    },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">Admin Dashboard</h1>
        <p className="mt-1.5 text-ink-soft">Tizim holati va foydalanuvchilarni boshqarish markazi.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="group relative overflow-hidden rounded-[2rem] border border-rim bg-white p-8 shadow-sm transition-all hover:shadow-md active:scale-[0.98]">
            <div className={cn(
              "absolute top-0 right-0 h-32 w-32 -translate-y-12 translate-x-12 rounded-full opacity-[0.03] transition-transform group-hover:scale-110",
              stat.color === 'blue' ? "bg-blue" : stat.color === 'green' ? "bg-teal" : stat.color === 'orange' ? "bg-orange" : "bg-purple"
            )} />
            
            <div className="flex items-center justify-between">
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm",
                stat.color === 'blue' ? "bg-blue/10 text-blue" : stat.color === 'green' ? "bg-teal/10 text-teal" : stat.color === 'orange' ? "bg-orange/10 text-orange" : "bg-purple/10 text-purple"
              )}>
                <stat.icon className="h-6 w-6" />
              </div>
              <div className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                stat.trendUp ? "bg-teal/10 text-teal" : "bg-red/10 text-red"
              )}>
                {stat.trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {stat.trend}
              </div>
            </div>
            
            <div className="mt-6">
              <p className="text-sm font-bold text-ink-soft uppercase tracking-widest">{stat.label}</p>
              <p className="mt-1 text-4xl font-black text-ink-strong tabular-nums">
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Recent Audit Logs */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between px-2">
             <h2 className="text-xl font-black text-ink-strong">Oxirgi harakatlar</h2>
             <button className="text-sm font-bold text-blue hover:underline">Barchasini ko&apos;rish</button>
          </div>
          
          <div className="rounded-[2.5rem] border border-rim bg-white p-2 shadow-sm overflow-hidden">
             <table className="w-full text-left">
                <thead>
                   <tr className="border-b border-rim text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint">
                      <th className="px-6 py-5">Admin</th>
                      <th className="px-6 py-5">Harakat</th>
                      <th className="px-6 py-5">Sana</th>
                      <th className="px-6 py-5 text-right">IP</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-rim">
                   {auditData?.items.map((log) => (
                      <tr key={log.id} className="group hover:bg-tint/30 transition-colors">
                         <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                               <div className="h-8 w-8 rounded-xl bg-blue/10 flex items-center justify-center text-[10px] font-black text-blue">
                                  {log.adminEmail ? log.adminEmail.charAt(0).toUpperCase() : '?'}
                               </div>
                               <span className="text-sm font-bold text-ink-strong">{log.adminEmail || 'Tizim'}</span>
                            </div>
                         </td>
                         <td className="px-6 py-5">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-tint px-2 py-1 text-[11px] font-bold text-ink-strong">
                               {log.action}
                            </span>
                         </td>
                         <td className="px-6 py-5">
                            <span className="text-[11px] font-medium text-ink-soft">
                               {new Date(log.createdAt).toLocaleString('uz-UZ')}
                            </span>
                         </td>
                         <td className="px-6 py-5 text-right">
                            <code className="text-[10px] font-mono font-bold text-ink-faint">{log.ip}</code>
                         </td>
                      </tr>
                   ))}
                </tbody>
             </table>
          </div>
        </div>

        {/* System Health / Shortcuts */}
        <div className="space-y-6">
           <h2 className="text-xl font-black text-ink-strong px-2">Tizim holati</h2>
           <div className="rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm space-y-8">
              <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-soft">API Server</span>
                    <span className="flex h-2 w-2 rounded-full bg-teal animate-pulse shadow-[0_0_8px_rgba(50,173,230,0.8)]" />
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-soft">Ma&apos;lumotlar bazasi</span>
                    <span className="flex h-2 w-2 rounded-full bg-teal" />
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-soft">Redis Cache</span>
                    <span className="flex h-2 w-2 rounded-full bg-teal" />
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink-soft">LiveKit SFU</span>
                    <span className="flex h-2 w-2 rounded-full bg-teal shadow-[0_0_8px_rgba(50,173,230,0.8)]" />
                 </div>
              </div>

              <div className="h-px bg-rim" />

              <div className="space-y-4">
                 <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-1">Tezkor havolalar</p>
                 <Link href={`/${params.locale}/admin/specialties`} className="flex w-full items-center justify-between rounded-2xl bg-tint p-4 text-sm font-bold text-ink-strong hover:bg-blue/10 hover:text-blue transition-all group border border-transparent hover:border-blue/20">
                    Mutaxassisliklarni boshqarish
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                 </Link>
                 <Link href={`/${params.locale}/admin/users`} className="flex w-full items-center justify-between rounded-2xl bg-tint p-4 text-sm font-bold text-ink-strong hover:bg-blue/10 hover:text-blue transition-all group border border-transparent hover:border-blue/20">
                    Foydalanuvchilarni moderatsiya qilish
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                 </Link>
                 <Link href={`/${params.locale}/admin/audit-logs`} className="flex w-full items-center justify-between rounded-2xl bg-tint p-4 text-sm font-bold text-ink-strong hover:bg-blue/10 hover:text-blue transition-all group border border-transparent hover:border-blue/20">
                    Xavfsizlik auditini ko&apos;rish
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                 </Link>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
