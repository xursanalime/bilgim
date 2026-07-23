'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Save, 
  Loader2,
  ListOrdered,
  BookOpen,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { adminApi, AdminOnboardingQuestion, AdminSpecialty } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';
import { toast } from 'sonner';

export default function AdminOnboardingPage() {
  const queryClient = useQueryClient();
  const { data: questions, isLoading } = useQuery({
    queryKey: ['admin', 'onboarding-questions'],
    queryFn: () => adminApi.listOnboardingQuestions(),
  });

  const { data: specialties } = useQuery({
    queryKey: ['admin', 'specialties'],
    queryFn: () => adminApi.listSpecialties(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<AdminOnboardingQuestion>) =>
      adminApi.createOnboardingQuestion(data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding-questions'] });
      toast.success('Savol yaratildi');
      setIsAdding(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AdminOnboardingQuestion> }) =>
      adminApi.updateOnboardingQuestion(id, data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding-questions'] });
      toast.success('Savol yangilandi');
      setEditingId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<AdminOnboardingQuestion>>({});

  const handleEdit = (question: AdminOnboardingQuestion) => {
    setEditingId(question.id);
    setFormData({
      ...question,
      optionsJson: JSON.stringify(question.optionsJson, null, 2)
    } as any);
  };

  const handleSave = () => {
    try {
      const data = {
        ...formData,
        optionsJson: typeof formData.optionsJson === 'string' ? JSON.parse(formData.optionsJson) : formData.optionsJson
      };
      if (editingId) {
        updateMutation.mutate({ id: editingId, data });
      } else {
        createMutation.mutate(data);
      }
    } catch (e) {
      toast.error('Options JSON formati noto\'g\'ri');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue" />
      </div>
    );
  }

  const groupedQuestions = questions?.reduce((acc: Record<string, AdminOnboardingQuestion[]>, q: AdminOnboardingQuestion) => {
    const key = q.specialtyId || 'COMMON';
    if (!acc[key]) acc[key] = [];
    acc[key].push(q);
    return acc;
  }, {} as Record<string, AdminOnboardingQuestion[]>);

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Onboarding Savollari</h1>
          <p className="mt-1.5 text-ink-soft">O&apos;qituvchilarni ro&apos;yxatdan o&apos;tkazish va mutaxassisligini aniqlash savollari.</p>
        </div>
        <button 
          onClick={() => {
            setIsAdding(true);
            setFormData({ 
              isActive: true, 
              order: (questions?.length || 0) + 1,
              optionsJson: '[]'
            });
          }}
          className="flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-black text-white shadow-[0_8px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Yangi savol
        </button>
      </header>

      <div className="space-y-12">
        {Object.entries(groupedQuestions || {}).map(([specialtyId, qList]) => {
          const specialty = specialties?.find((s: AdminSpecialty) => s.id === specialtyId);
          return (
            <section key={specialtyId} className="space-y-6">
              <div className="flex items-center gap-3 px-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-blue">
                  <BookOpen className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-ink-strong">
                  {specialtyId === 'COMMON' ? 'Umumiy savollar' : `${specialty?.nameUz} savollari`}
                </h2>
                <span className="rounded-full bg-tint px-2.5 py-1 text-[10px] font-black text-ink-soft uppercase tracking-wider">
                  {(qList as AdminOnboardingQuestion[]).length} savol
                </span>
              </div>

              <div className="grid gap-4">
                {(qList as AdminOnboardingQuestion[]).sort((a: AdminOnboardingQuestion, b: AdminOnboardingQuestion) => a.order - b.order).map((question: AdminOnboardingQuestion) => (
                  <div 
                    key={question.id} 
                    className="group flex items-center justify-between rounded-[2rem] border border-rim bg-white p-6 transition-all hover:shadow-md"
                  >
                    <div className="flex items-center gap-6">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-lg font-black text-ink-faint">
                        {question.order}
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-ink-strong">{question.textUz}</h3>
                        <p className="text-xs text-ink-soft">{question.textRu} • {question.textEn}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                        question.isActive ? "bg-teal/10 text-teal" : "bg-red/10 text-red"
                      )}>
                        {question.isActive ? 'Aktiv' : 'Nofaol'}
                      </span>
                      <button 
                        onClick={() => handleEdit(question)}
                        className="rounded-xl bg-tint px-4 py-2 text-xs font-black text-ink-strong transition-colors hover:bg-blue/10 hover:text-blue"
                      >
                        Tahrirlash
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Edit/Add Modal */}
      {(isAdding || editingId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/20 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200 rounded-[3rem] border border-rim bg-white p-10 shadow-2xl">
            <h2 className="text-2xl font-black text-ink-strong mb-8">
              {editingId ? 'Savolni tahrirlash' : 'Yangi savol yaratish'}
            </h2>
            
            <div className="grid gap-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Mutaxassislik</label>
                  <select 
                    value={formData.specialtyId || ''}
                    onChange={(e) => setFormData({ ...formData, specialtyId: e.target.value || null })}
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                  >
                    <option value="">Umumiy (Barcha uchun)</option>
                    {specialties?.map((s: AdminSpecialty) => (
                      <option key={s.id} value={s.id}>{s.nameUz}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Tartib (Order)</label>
                  <input 
                    type="number" 
                    value={formData.order || 0}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) })}
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Savol matni (O&apos;zbekcha)</label>
                  <input 
                    type="text" 
                    value={formData.textUz || ''}
                    onChange={(e) => setFormData({ ...formData, textUz: e.target.value })}
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Savol matni (Ruscha)</label>
                  <input 
                    type="text" 
                    value={formData.textRu || ''}
                    onChange={(e) => setFormData({ ...formData, textRu: e.target.value })}
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Savol matni (Inglizcha)</label>
                  <input 
                    type="text" 
                    value={formData.textEn || ''}
                    onChange={(e) => setFormData({ ...formData, textEn: e.target.value })}
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Variantlar (Options JSON)</label>
                <textarea 
                  value={formData.optionsJson || ''}
                  onChange={(e) => setFormData({ ...formData, optionsJson: e.target.value })}
                  rows={6}
                  placeholder='[{"id": "opt1", "textUz": "Variant 1", "score": 10}]'
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-mono font-bold outline-none focus:border-blue/30"
                />
              </div>

              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="isActive"
                  checked={formData.isActive || false}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="h-5 w-5 rounded-lg border-rim text-blue focus:ring-blue"
                />
                <label htmlFor="isActive" className="text-sm font-bold text-ink-strong">Aktiv holatda</label>
              </div>
            </div>

            <div className="mt-10 flex gap-4">
              <button 
                onClick={() => {
                  setEditingId(null);
                  setIsAdding(false);
                }}
                className="flex-1 rounded-2xl border border-rim bg-white py-4 text-sm font-black text-ink-soft transition-colors hover:bg-tint"
              >
                Bekor qilish
              </button>
              <button 
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue py-4 text-sm font-black text-white shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
