'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  Check, 
  X,
  Loader2,
  BookOpen,
  Code
} from 'lucide-react';
import { adminApi, AdminSpecialty } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';

export default function AdminSpecialtiesPage() {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'specialties', 'withCounts'],
    queryFn: () => adminApi.listSpecialtiesWithCounts(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<AdminSpecialty>) => 
      adminApi.createSpecialty(data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'specialties'] });
      setIsAdding(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AdminSpecialty> }) => 
      adminApi.updateSpecialty(id, data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'specialties'] });
      setEditingId(null);
    },
  });

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Mutaxassisliklar</h1>
          <p className="mt-1 text-ink-soft">Ta&apos;lim yo&apos;nalishlari va ularning modullarini boshqarish.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex h-12 items-center gap-2 rounded-2xl bg-blue px-6 text-sm font-black text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Yangi yo&apos;nalish
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
           <div className="col-span-full py-20 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue" />
           </div>
        ) : (
          <>
            {isAdding && (
              <SpecialtyCard 
                isNew 
                onCancel={() => setIsAdding(false)}
                onSave={(data) => createMutation.mutate(data)}
                loading={createMutation.isPending}
              />
            )}
            {data?.map((s) => (
              <SpecialtyCard 
                key={s.id}
                specialty={s}
                isEditing={editingId === s.id}
                onEdit={() => setEditingId(s.id)}
                onCancel={() => setEditingId(null)}
                onSave={(data) => updateMutation.mutate({ id: s.id, data })}
                loading={updateMutation.isPending}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SpecialtyCard({
  specialty,
  isNew,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  loading
}: {
  specialty?: AdminSpecialty & { teacherCount?: number };
  isNew?: boolean;
  isEditing?: boolean;
  onEdit?: () => void;
  onCancel: () => void;
  onSave: (data: any) => void;
  loading?: boolean;
}) {
  const [formData, setFormData] = useState({
    nameUz: specialty?.nameUz || '',
    slug: specialty?.slug || '',
    dashboardKey: specialty?.dashboardKey || 'general',
    isActive: specialty?.isActive ?? true,
  });

  if (isNew || isEditing) {
    return (
      <div className="rounded-[2.5rem] border-2 border-blue/20 bg-white p-8 shadow-xl space-y-6">
        <div className="space-y-4">
           <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-1">Nomi (UZ)</label>
              <input 
                className="mt-1.5 w-full rounded-2xl border border-rim bg-tint/50 px-4 py-3 text-sm font-bold outline-none focus:border-blue focus:bg-white"
                value={formData.nameUz}
                onChange={e => setFormData({...formData, nameUz: e.target.value})}
                placeholder="Masalan: Frontend Dasturlash"
              />
           </div>
           <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-1">Slug (URL)</label>
              <input 
                className="mt-1.5 w-full rounded-2xl border border-rim bg-tint/50 px-4 py-3 text-sm font-bold outline-none focus:border-blue focus:bg-white"
                value={formData.slug}
                onChange={e => setFormData({...formData, slug: e.target.value})}
                placeholder="frontend-dev"
              />
           </div>
           <div className="flex items-center gap-4">
              <div className="flex-1">
                 <label className="text-[10px] font-black uppercase tracking-widest text-ink-faint px-1">Dashboard</label>
                 <select 
                   className="mt-1.5 w-full rounded-2xl border border-rim bg-tint/50 px-4 py-3 text-sm font-bold outline-none focus:border-blue focus:bg-white"
                   value={formData.dashboardKey}
                   onChange={e => setFormData({...formData, dashboardKey: e.target.value})}
                 >
                    <option value="general">Umumiy</option>
                    <option value="tech">Texnik</option>
                    <option value="language">Til o&apos;rganish</option>
                 </select>
              </div>
              <div className="pt-6 flex items-center gap-2">
                 <input 
                   type="checkbox" 
                   id="active"
                   className="h-5 w-5 rounded-lg border-rim text-blue focus:ring-blue"
                   checked={formData.isActive}
                   onChange={e => setFormData({...formData, isActive: e.target.checked})}
                 />
                 <label htmlFor="active" className="text-sm font-bold text-ink-strong">Aktiv</label>
              </div>
           </div>
        </div>

        <div className="flex gap-2">
           <button 
             disabled={loading}
             onClick={() => onSave(formData)}
             className="flex-1 h-12 rounded-xl bg-blue text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
           >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Saqlash
           </button>
           <button 
             onClick={onCancel}
             className="h-12 w-12 rounded-xl border border-rim flex items-center justify-center text-ink-soft hover:bg-tint"
           >
              <X className="h-4 w-4" />
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm transition-all hover:shadow-md active:scale-[0.98]">
      <div className="flex items-start justify-between">
        <div className="h-14 w-14 rounded-3xl bg-blue/10 flex items-center justify-center text-blue shadow-inner">
           <Code className="h-7 w-7" />
        </div>
        <div className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
          specialty?.isActive ? "bg-green/10 text-green" : "bg-red/10 text-red"
        )}>
          {specialty?.isActive ? 'Aktiv' : 'Nofaol'}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-xl font-black text-ink-strong">{specialty?.nameUz}</h3>
        <p className="mt-1 text-sm font-medium text-ink-soft italic">/{specialty?.slug}</p>
      </div>

      <div className="mt-8 flex items-center justify-between">
         <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-ink-faint">
            <BookOpen className="h-3.5 w-3.5" />
            {specialty?.teacherCount ?? 0} o&apos;qituvchi
         </div>
         <button 
           onClick={onEdit}
           className="h-10 w-10 rounded-xl border border-rim flex items-center justify-center text-ink-faint hover:text-blue hover:border-blue transition-all"
         >
            <Edit2 className="h-4 w-4" />
         </button>
      </div>
    </div>
  );
}
