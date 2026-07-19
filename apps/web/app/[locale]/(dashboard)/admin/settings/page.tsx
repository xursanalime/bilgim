'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Settings, 
  Plus, 
  Save, 
  Trash2, 
  AlertCircle,
  Loader2,
  Info
} from 'lucide-react';
import { adminApi, AdminSystemSetting } from '../../../../../lib/api/admin';
import { cn } from '../../../../../lib/utils';
import { toast } from 'sonner';

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin', 'system-settings'],
    queryFn: () => adminApi.listSystemSettings(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value, description }: { key: string; value: any; description?: string }) =>
      adminApi.updateSystemSetting(key, value, description, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system-settings'] });
      toast.success('Sozlama saqlandi');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');

  const handleEdit = (setting: AdminSystemSetting) => {
    setEditingKey(setting.key);
    setEditValue(JSON.stringify(setting.value, null, 2));
    setEditDescription(setting.description || '');
  };

  const handleSave = () => {
    if (!editingKey) return;
    try {
      const parsedValue = JSON.parse(editValue);
      updateMutation.mutate({ 
        key: editingKey, 
        value: parsedValue, 
        description: editDescription 
      });
      setEditingKey(null);
    } catch (e) {
      toast.error('JSON formati noto\'g\'ri');
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
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">Tizim Sozlamalari</h1>
          <p className="mt-1.5 text-ink-soft">Tizim global parametrlarini kod yozmasdan boshqarish.</p>
        </div>
        <button 
          onClick={() => {
            setEditingKey('NEW_SETTING');
            setEditValue('{}');
            setEditDescription('');
          }}
          className="flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-black text-white shadow-[0_8px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Yangi sozlama
        </button>
      </header>

      <div className="grid gap-6">
        {settings?.map((setting: AdminSystemSetting) => (
          <div 
            key={setting.key} 
            className="group rounded-[2.5rem] border border-rim bg-white p-8 shadow-sm transition-all hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <code className="rounded-lg bg-tint px-2 py-1 text-sm font-black text-blue">
                    {setting.key}
                  </code>
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-widest">
                    Yangilangan: {new Date(setting.updatedAt).toLocaleString('uz-UZ')}
                  </span>
                </div>
                <p className="text-sm font-medium text-ink-soft">
                  {setting.description || 'Tavsif berilmagan'}
                </p>
              </div>
              
              <button 
                onClick={() => handleEdit(setting)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint text-ink-soft transition-colors hover:bg-blue/10 hover:text-blue"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 rounded-2xl bg-ink-strong/5 p-4">
              <pre className="text-xs font-mono text-ink-strong overflow-x-auto">
                {JSON.stringify(setting.value, null, 2)}
              </pre>
            </div>
          </div>
        ))}

        {settings?.length === 0 && !editingKey && (
          <div className="flex flex-col items-center justify-center rounded-[3rem] border-2 border-dashed border-rim bg-white py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-tint text-ink-faint mb-6">
              <Settings className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-black text-ink-strong">Sozlamalar mavjud emas</h3>
            <p className="mt-2 text-ink-soft max-w-xs mx-auto">Tizimni boshqarish uchun birinchi sozlamani qo&apos;shing.</p>
          </div>
        )}
      </div>

      {/* Edit Modal / Drawer (simplified as overlay for this example) */}
      {editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/20 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl animate-in zoom-in-95 fade-in duration-200 rounded-[3rem] border border-rim bg-white p-10 shadow-2xl">
            <h2 className="text-2xl font-black text-ink-strong mb-2">Sozlamani tahrirlash</h2>
            <p className="text-sm text-ink-soft mb-8">Kalit: <span className="font-black text-blue">{editingKey}</span></p>
            
            <div className="space-y-6">
              {editingKey === 'NEW_SETTING' && (
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Sozlama kaliti (KEY)</label>
                  <input 
                    type="text" 
                    placeholder="MAINTENANCE_MODE"
                    className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                    onChange={(e) => setEditingKey(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Tavsif</label>
                <input 
                  type="text" 
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Bu sozlama nima qiladi?"
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Qiymat (JSON)</label>
                <textarea 
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={8}
                  className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-mono font-bold outline-none focus:border-blue/30"
                />
                <p className="flex items-center gap-1.5 text-[10px] font-bold text-ink-faint">
                  <Info className="h-3 w-3" />
                  JSON formatida bo&apos;lishi shart (masalan: true, 123, &quot;text&quot;, {"{}"}, [])
                </p>
              </div>
            </div>

            <div className="mt-10 flex gap-4">
              <button 
                onClick={() => setEditingKey(null)}
                className="flex-1 rounded-2xl border border-rim bg-white py-3 text-sm font-black text-ink-soft transition-colors hover:bg-tint"
              >
                Bekor qilish
              </button>
              <button 
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue py-3 text-sm font-black text-white shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
