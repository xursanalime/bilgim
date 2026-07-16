'use client';

import { useState, useEffect } from 'react';
import { User, Mail, Camera, Save, Phone, MapPin, Loader2, Info, AtSign } from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiClient as api } from '../../lib/api-client';

interface ProfileSettingsProps {
  email: string;
  role: string;
  initialUsername?: string;
}

export function ProfileSettings({ email, role, initialUsername = '' }: ProfileSettingsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const [username, setUsername] = useState(initialUsername);
  const [originalUsername, setOriginalUsername] = useState(initialUsername);
  const [currentEmail, setCurrentEmail] = useState(email);
  
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    location: '',
    bio: ''
  });

  useEffect(() => {
    let mounted = true;
    
    async function fetchProfile() {
      try {
        const data: any = await api.get('/users/me');
        if (mounted) {
          setUsername(data.username || '');
          setOriginalUsername(data.username || '');
          if (data.email) setCurrentEmail(data.email);
          setFormData({
            fullName: data.fullName || '',
            phone: data.phone || '',
            location: data.location || '',
            bio: data.bio || ''
          });
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Failed to load profile', err);
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    
    fetchProfile();
    
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    
    try {
      if (username !== originalUsername) {
        await api.patch('/users/me/username', { username });
        setOriginalUsername(username);
      }
      
      await api.put('/users/me/profile', formData);
      
      setSuccessMsg("Ma'lumotlar muvaffaqiyatli saqlandi!");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Xatolik yuz berdi');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse sm:space-y-8">
        <div className="h-40 rounded-[2rem] bg-rim/20 sm:rounded-[2.5rem]"></div>
        <div className="h-96 rounded-[2rem] bg-rim/20 sm:rounded-[2.5rem]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:space-y-8">
      <header className="group relative overflow-hidden rounded-[2rem] border border-rim bg-white p-5 shadow-soft sm:rounded-[2.5rem] sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative self-center sm:self-auto">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[1.25rem] bg-tint border-2 border-white shadow-md sm:h-24 sm:w-24 sm:rounded-[1.5rem]">
              <User className="h-8 w-8 text-ink-faint sm:h-10 sm:w-10" />
            </div>
            <button
              type="button"
              aria-label="Profil rasmini o'zgartirish"
              className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-blue text-white shadow-sm transition-transform hover:scale-110 active:scale-95 border-2 border-white sm:h-8 sm:w-8 sm:rounded-xl">
              <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
          
          <div className="space-y-2 text-center sm:text-left">
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center">
              <h2 className="font-display text-xl font-extrabold text-ink-strong sm:text-2xl">Shaxsiy ma'lumotlar</h2>
              <span className="rounded-full bg-blue/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue">
                {role === 'TEACHER' ? "O'qituvchi" : role === 'STUDENT' ? 'Talaba' : 'Admin'}
              </span>
            </div>
            <p className="text-sm text-ink-soft opacity-80 max-w-md">
              Profilingizni sozlang va oʻzingiz haqingizda maʼlumot bering.
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
        <section className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft sm:rounded-[2.5rem]">
          <div className="border-b border-rim bg-tint/30 px-6 py-4 sm:px-8 sm:py-5">
            <h3 className="font-display text-base font-extrabold text-ink-strong">Asosiy ma'lumotlar</h3>
            <p className="text-xs text-ink-faint">Bu ma'lumotlar profilingizda ko'rsatiladi.</p>
          </div>
          
          <div className="p-6 space-y-6 sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
              {/* Username Field */}
              <div className="space-y-2 sm:col-span-2">
                <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Username</label>
                <div className="relative">
                  <AtSign className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                  />
                </div>
              </div>

              {/* Full Name */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">To'liq ism</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                    placeholder="Ismingiz va familiyangiz"
                    className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                  />
                </div>
              </div>

              {/* Email (Readonly) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Email manzil</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="email"
                    value={currentEmail}
                    disabled
                    className="w-full cursor-not-allowed rounded-2xl border border-rim bg-tint/50 py-3 pl-11 pr-4 text-sm font-medium text-ink-soft opacity-70 outline-none"
                  />
                </div>
                <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink-faint pt-1">
                  <Info className="h-3 w-3" />
                  Email manzilni o'zgartirish uchun murojaat qiling
                </p>
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Telefon raqam</label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+998 90 123 45 67"
                    className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Manzil</label>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Shahar, Davlat"
                    className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-11 pr-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                  />
                </div>
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Qisqacha ma'lumot (Bio)</label>
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                placeholder="O'zingiz haqingizda qisqacha ma'lumot yozing..."
                rows={4}
                className="w-full resize-none rounded-[1.25rem] border border-rim bg-tint/30 p-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
              />
            </div>
          </div>
        </section>

        {error && <div className="text-sm font-medium text-red-500 text-right">{error}</div>}
        {successMsg && <div className="text-sm font-medium text-green-500 text-right">{successMsg}</div>}

        <div className="flex justify-end pt-2 pb-6">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            {isSubmitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saqlanmoqda</>
            ) : (
              <><Save className="h-4 w-4" /> O'zgarishlarni saqlash</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
