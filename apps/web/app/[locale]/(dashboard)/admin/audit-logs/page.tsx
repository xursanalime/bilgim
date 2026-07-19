'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  History, 
  Search, 
  Calendar, 
  Shield, 
  ChevronLeft, 
  ChevronRight,
  Loader2,
  Terminal
} from 'lucide-react';
import { adminApi } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';

export default function AdminAuditLogsPage() {
  const [page, setPage] = useState(1);
  const [adminId, setAdminId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-logs', { page, limit: 15, adminId }],
    queryFn: () => adminApi.listAuditLogs({ page, limit: 15, adminId }),
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Audit Loglar</h1>
          <p className="mt-1 text-ink-soft">Tizimdagi barcha ma&apos;muriy harakatlar xronologiyasi.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <input 
                type="text" 
                placeholder="Admin ID bo&apos;yicha..." 
                className="h-12 w-full rounded-2xl border border-rim bg-white pl-11 pr-4 text-sm font-bold outline-none focus:border-blue sm:w-64"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
              />
           </div>
        </div>
      </header>

      <div className="rounded-[2.5rem] border border-rim bg-white p-2 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-rim text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint">
              <th className="px-6 py-5">Admin</th>
              <th className="px-6 py-5">Harakat</th>
              <th className="px-6 py-5">Sana</th>
              <th className="px-6 py-5">IP Manzil</th>
              <th className="px-6 py-5 text-right">Tafsilotlar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rim text-sm">
            {isLoading ? (
               <tr>
                  <td colSpan={5} className="py-20 text-center">
                     <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue" />
                  </td>
               </tr>
            ) : data?.items.map((log) => (
              <tr key={log.id} className="group hover:bg-tint/30 transition-colors">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-orange/10 flex items-center justify-center text-[10px] font-black text-orange">
                      {log.adminEmail ? log.adminEmail.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div>
                      <p className="font-black text-ink-strong leading-tight">{log.adminEmail || 'Tizim'}</p>
                      <p className="text-[10px] font-mono font-medium text-ink-faint tabular-nums truncate max-w-[120px]">
                        {log.adminId}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                   <span className="inline-flex items-center gap-1.5 rounded-lg bg-tint px-2.5 py-1 text-[11px] font-black text-ink-strong border border-rim">
                      <Terminal className="h-3 w-3 text-blue" />
                      {log.action}
                   </span>
                </td>
                <td className="px-6 py-5">
                  <div className="flex flex-col">
                     <span className="text-xs font-bold text-ink-strong">
                       {new Date(log.createdAt).toLocaleDateString('uz-UZ')}
                     </span>
                     <span className="text-[10px] font-medium text-ink-soft">
                       {new Date(log.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                     </span>
                  </div>
                </td>
                <td className="px-6 py-5 font-mono text-[11px] font-bold text-ink-soft">
                  {log.ip}
                </td>
                <td className="px-6 py-5 text-right">
                  <button className="text-[10px] font-black uppercase tracking-widest text-blue hover:underline">
                    Context (JSON)
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
           <div className="flex items-center justify-between border-t border-rim p-6">
              <p className="text-xs font-bold text-ink-soft uppercase tracking-widest">
                 Sahifa {page} / {totalPages}
              </p>
              <div className="flex items-center gap-2">
                 <button 
                   disabled={page === 1}
                   onClick={() => setPage(p => p - 1)}
                   className="h-10 w-10 rounded-xl border border-rim flex items-center justify-center disabled:opacity-30 hover:bg-tint transition-all"
                 >
                    <ChevronLeft className="h-4 w-4" />
                 </button>
                 <button 
                   disabled={page === totalPages}
                   onClick={() => setPage(p => p + 1)}
                   className="h-10 w-10 rounded-xl border border-rim flex items-center justify-center disabled:opacity-30 hover:bg-tint transition-all"
                 >
                    <ChevronRight className="h-4 w-4" />
                 </button>
              </div>
           </div>
        )}
      </div>
    </div>
  );
}
