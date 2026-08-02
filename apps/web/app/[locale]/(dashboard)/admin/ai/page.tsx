'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Save, 
  Loader2,
  Sparkles,
  Search,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { adminApi, AdminAiPromptTemplate } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';
import { AI_ENABLED } from '../../../../../lib/features';
import { toast } from 'sonner';

export default function AdminAiPromptsPage() {
  // AI is out of the MVP; the prompt editor goes with it. Hiding the nav
  // entry is not enough — the URL must 404 too.
  if (!AI_ENABLED) notFound();

  const queryClient = useQueryClient();
  const { data: prompts, isLoading } = useQuery({
    queryKey: ['admin', 'ai-prompts'],
    queryFn: () => adminApi.listAiPrompts(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<AdminAiPromptTemplate>) =>
      adminApi.createAiPrompt(data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-prompts'] });
      toast.success('Prompt yaratildi');
      setIsAdding(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AdminAiPromptTemplate> }) =>
      adminApi.updateAiPrompt(id, data, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-prompts'] });
      toast.success('Prompt yangilandi');
      setEditingId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<AdminAiPromptTemplate>>({});

  const handleEdit = (prompt: AdminAiPromptTemplate) => {
    setEditingId(prompt.id);
    setFormData(prompt);
  };

  const handleSave = () => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">AI Promptlar</h1>
          <p className="mt-1.5 text-ink-soft">AI yordamchi uchun tizim ko&apos;rsatmalari va parametrlarini boshqarish.</p>
        </div>
        <button 
          onClick={() => {
            setIsAdding(true);
            setFormData({ 
              isActive: true, 
              modelName: 'claude-3-5-sonnet-latest',
              maxTokens: 2000 
            });
          }}
          className="flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-black text-white shadow-[0_8px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Yangi prompt
        </button>
      </header>

      <div className="grid gap-8">
        {prompts?.map((prompt: AdminAiPromptTemplate) => (
          <div 
            key={prompt.id} 
            className="group rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm transition-all hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-black text-ink-strong">{prompt.key}</h3>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                    prompt.isActive ? "bg-teal/10 text-teal" : "bg-red/10 text-red"
                  )}>
                    {prompt.isActive ? 'Aktiv' : 'Nofaol'}
                  </span>
                  <span className="rounded-lg bg-blue/10 px-2 py-0.5 text-[10px] font-black text-blue uppercase tracking-wider">
                    {prompt.intent}
                  </span>
                </div>
                <p className="text-sm font-bold text-ink-soft">{prompt.modelName} • Max Tokens: {prompt.maxTokens}</p>
              </div>
              <button 
                onClick={() => handleEdit(prompt)}
                className="rounded-xl bg-tint px-4 py-2 text-sm font-black text-ink-strong transition-colors hover:bg-blue/10 hover:text-blue"
              >
                Tahrirlash
              </button>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint">System Text</p>
                <div className="rounded-2xl border border-rim bg-tint p-4 text-xs font-medium text-ink-strong h-32 overflow-y-auto italic">
                  &quot;{prompt.systemText}&quot;
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-ink-faint">User Template</p>
                <div className="rounded-2xl border border-rim bg-tint p-4 text-xs font-mono text-ink-strong h-32 overflow-y-auto">
                  {prompt.userTemplate}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Add Modal */}
      {(isAdding || editingId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-tint-strong/20 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200 rounded-[3rem] border border-rim bg-white p-10 shadow-2xl">
            <h2 className="text-2xl font-black text-ink-strong mb-8">
              {editingId ? 'Promptni tahrirlash' : 'Yangi prompt yaratish'}
            </h2>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Kalit (Unique Key)</label>
                <input 
                  type="text" 
                  value={formData.key || ''}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  disabled={!!editingId}
                  placeholder="TUTOR_EXPLAIN_DEFAULT"
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30 disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Intent</label>
                <select 
                  value={formData.intent || ''}
                  onChange={(e) => setFormData({ ...formData, intent: e.target.value as any })}
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                >
                  <option value="">Tanlang...</option>
                  <option value="TUTOR_EXPLAIN">Explain</option>
                  <option value="TUTOR_TRANSLATE">Translate</option>
                  <option value="TUTOR_EXAMPLE">Example</option>
                  <option value="GRADE_PRECHECK">Grade Precheck</option>
                  <option value="AI_TEXT_DETECT">AI Detection</option>
                  <option value="SPECIALTY_CLASSIFY">Specialty Classify</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Model</label>
                <input 
                  type="text" 
                  value={formData.modelName || ''}
                  onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Max Tokens</label>
                <input 
                  type="number" 
                  value={formData.maxTokens || 0}
                  onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">System Text (AI Instructions)</label>
                <textarea 
                  value={formData.systemText || ''}
                  onChange={(e) => setFormData({ ...formData, systemText: e.target.value })}
                  rows={4}
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-medium outline-none focus:border-blue/30"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">User Template (Handlebars support)</label>
                <textarea 
                  value={formData.userTemplate || ''}
                  onChange={(e) => setFormData({ ...formData, userTemplate: e.target.value })}
                  rows={4}
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
                <label htmlFor="isActive" className="text-sm font-bold text-ink-strong underline decoration-blue/20">Aktiv holatda</label>
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
