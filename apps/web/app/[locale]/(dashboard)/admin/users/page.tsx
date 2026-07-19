'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Search, 
  Filter, 
  MoreVertical, 
  UserMinus, 
  UserCheck, 
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { adminApi, AdminUser } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', { page, limit: 10, role: roleFilter, q: search }],
    queryFn: () => adminApi.listUsers({ page, limit: 10, role: roleFilter, q: search }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => 
      adminApi.updateUserStatus(id, status, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / 10);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Foydalanuvchilar</h1>
          <p className="mt-1 text-ink-soft">Tizimdagi barcha talaba va o&apos;qituvchilarni boshqarish.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <input 
                type="text" 
                placeholder="Ism yoki email bo&apos;yicha qidiruv..." 
                className="h-12 w-full rounded-2xl border border-rim bg-white pl-11 pr-4 text-sm font-bold outline-none focus:border-blue sm:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
           <select 
             className="h-12 rounded-2xl border border-rim bg-white px-4 text-sm font-bold outline-none focus:border-blue"
             value={roleFilter}
             onChange={(e) => setRoleFilter(e.target.value)}
           >
              <option value="">Barcha rollar</option>
              <option value="STUDENT">Talabalar</option>
              <option value="TEACHER">O&apos;qituvchilar</option>
              <option value="ADMIN">Adminlar</option>
           </select>
        </div>
      </header>

      <div className="rounded-[2.5rem] border border-rim bg-white p-2 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-rim text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint">
              <th className="px-6 py-5">Foydalanuvchi</th>
              <th className="px-6 py-5">Rol</th>
              <th className="px-6 py-5">Holat</th>
              <th className="px-6 py-5">Ro&apos;yxatdan o&apos;tgan</th>
              <th className="px-6 py-5 text-right">Amallar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rim text-sm">
            {isLoading ? (
               <tr>
                  <td colSpan={5} className="py-20 text-center">
                     <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue" />
                  </td>
               </tr>
            ) : data?.items.map((user) => (
              <tr key={user.id} className="group hover:bg-tint/30 transition-colors">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-blue/10 flex items-center justify-center text-xs font-black text-blue">
                      {user.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-black text-ink-strong">{user.fullName}</p>
                      <p className="text-xs font-medium text-ink-soft">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5 text-[11px] font-black uppercase tracking-wider text-ink-strong">
                  {user.role}
                </td>
                <td className="px-6 py-5">
                  <span className={cn(
                    "inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
                    user.status === 'ACTIVE' ? "bg-green/10 text-green" : 
                    user.status === 'SUSPENDED' ? "bg-red/10 text-red" : "bg-orange/10 text-orange"
                  )}>
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-5 text-xs text-ink-soft font-medium">
                  {new Date(user.createdAt).toLocaleDateString('uz-UZ')}
                </td>
                <td className="px-6 py-5 text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {user.status === 'ACTIVE' ? (
                       <button 
                         onClick={() => updateStatusMutation.mutate({ id: user.id, status: 'SUSPENDED' })}
                         className="h-9 w-9 rounded-xl hover:bg-red/10 flex items-center justify-center text-red transition-all"
                         title="Bloklash"
                       >
                         <UserMinus className="h-4 w-4" />
                       </button>
                    ) : (
                       <button 
                         onClick={() => updateStatusMutation.mutate({ id: user.id, status: 'ACTIVE' })}
                         className="h-9 w-9 rounded-xl hover:bg-green/10 flex items-center justify-center text-green transition-all"
                         title="Aktivlashtirish"
                       >
                         <UserCheck className="h-4 w-4" />
                       </button>
                    )}
                    <button className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center text-ink-faint transition-all">
                       <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
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
