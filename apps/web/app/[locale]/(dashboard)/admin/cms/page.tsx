'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Layout, 
  Save, 
  Loader2,
  Image as ImageIcon,
  Type,
  Link as LinkIcon,
  Eye
} from 'lucide-react';
import { adminApi } from '../../../../../lib/api/admin';
import { toast } from 'sonner';

export default function AdminCmsPage() {
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
      toast.success("CMS ma'lumotlari saqlandi");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Xatolik yuz berdi');
    }
  });

  const [cmsData, setCmsData] = useState<any>({
    heroTitleUz: "O'z kelajagingizni biz bilan quring",
    heroSubtitleUz: "Zamonaviy platforma orqali eng yaxshi o'qituvchilardan ta'lim oling.",
    featuredSpecialties: [],
    contactEmail: 'support@edubridge.uz',
    footerTextUz: '© 2026 Bilgim. Barcha huquqlar himoyalangan.'
  });

  useEffect(() => {
    const cmsSetting = settings?.find((s: any) => s.key === 'MARKETING_CONTENT');
    if (cmsSetting) {
      setCmsData(cmsSetting.value);
    }
  }, [settings]);

  const handleSave = () => {
    updateMutation.mutate({
      key: 'MARKETING_CONTENT',
      value: cmsData,
      description: 'Landing page marketing content'
    });
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
          <h1 className="text-3xl font-black tracking-tight text-ink-strong">CMS (Kontentni boshqarish)</h1>
          <p className="mt-1.5 text-ink-soft">Landing page va asosiy sahifalar matnlarini o&apos;zgartirish.</p>
        </div>
        <div className="flex gap-3">
          <button 
             onClick={() => window.open('/', '_blank')}
             className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-6 py-3 text-sm font-black text-ink-strong transition-all hover:bg-tint"
          >
            <Eye className="h-4 w-4" />
            Saytni ko&apos;rish
          </button>
          <button 
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-black text-white shadow-[0_8px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            O&apos;zgarishlarni saqlash
          </button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Hero Section */}
        <section className="space-y-6 rounded-[3rem] border border-rim bg-white p-10 shadow-sm">
          <div className="flex items-center gap-3 border-b border-rim pb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-blue">
              <Layout className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-black text-ink-strong">Hero Seksiyasi</h2>
          </div>

          <div className="space-y-6">
             <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Asosiy sarlavha (UZ)</label>
                <input 
                   type="text" 
                   value={cmsData.heroTitleUz}
                   onChange={(e) => setCmsData({ ...cmsData, heroTitleUz: e.target.value })}
                   className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
             </div>
             <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Kichik sarlavha (UZ)</label>
                <textarea 
                   value={cmsData.heroSubtitleUz}
                   onChange={(e) => setCmsData({ ...cmsData, heroSubtitleUz: e.target.value })}
                   rows={3}
                   className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
             </div>
          </div>
        </section>

        {/* Contact & Footer */}
        <section className="space-y-6 rounded-[3rem] border border-rim bg-white p-10 shadow-sm">
          <div className="flex items-center gap-3 border-b border-rim pb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-blue">
              <Type className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-black text-ink-strong">Aloqa va Footer</h2>
          </div>

          <div className="space-y-6">
             <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Qo&apos;llab-quvvatlash emaili</label>
                <input 
                   type="email" 
                   value={cmsData.contactEmail}
                   onChange={(e) => setCmsData({ ...cmsData, contactEmail: e.target.value })}
                   className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
             </div>
             <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Footer matni (UZ)</label>
                <input 
                   type="text" 
                   value={cmsData.footerTextUz}
                   onChange={(e) => setCmsData({ ...cmsData, footerTextUz: e.target.value })}
                   className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                />
             </div>
          </div>
        </section>

        {/* AI & Features (Simplified) */}
        <section className="lg:col-span-2 space-y-6 rounded-[3rem] border border-rim bg-white p-10 shadow-sm">
           <div className="flex items-center gap-3 border-b border-rim pb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-blue">
                 <ImageIcon className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-black text-ink-strong">Bannerlar va Havolalar</h2>
           </div>

           <div className="grid gap-8 md:grid-cols-3">
              <div className="space-y-2">
                 <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Telegram Bot Havolasi</label>
                 <div className="relative">
                    <LinkIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                    <input 
                       type="text" 
                       value={cmsData.telegramBotUrl || ''}
                       onChange={(e) => setCmsData({ ...cmsData, telegramBotUrl: e.target.value })}
                       className="w-full rounded-2xl border border-rim bg-tint pl-11 pr-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                    />
                 </div>
              </div>
              <div className="space-y-2">
                 <label className="text-xs font-black uppercase tracking-widest text-ink-faint">Instagram Profil</label>
                 <div className="relative">
                    <LinkIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                    <input 
                       type="text" 
                       value={cmsData.instagramUrl || ''}
                       onChange={(e) => setCmsData({ ...cmsData, instagramUrl: e.target.value })}
                       className="w-full rounded-2xl border border-rim bg-tint pl-11 pr-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                    />
                 </div>
              </div>
              <div className="space-y-2">
                 <label className="text-xs font-black uppercase tracking-widest text-ink-faint">YouTube Kanal</label>
                 <div className="relative">
                    <LinkIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                    <input 
                       type="text" 
                       value={cmsData.youtubeUrl || ''}
                       onChange={(e) => setCmsData({ ...cmsData, youtubeUrl: e.target.value })}
                       className="w-full rounded-2xl border border-rim bg-tint pl-11 pr-4 py-3 text-sm font-bold outline-none focus:border-blue/30"
                    />
                 </div>
              </div>
           </div>
        </section>
      </div>
    </div>
  );
}
