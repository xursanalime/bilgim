'use client';

import { useState } from 'react';
import { Shield, Key, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { changePassword } from '../../../../../lib/api/auth';
import { cn } from '../../../../../lib/utils';

export default function SettingsSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'Yangi parollar mos kelmaydi' });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ type: 'error', message: 'Yangi parol kamida 8 ta belgi bo\'lishi kerak' });
      return;
    }

    setIsLoading(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.ok) {
        setStatus({ type: 'success', message: result.data.message });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatus({ type: 'error', message: result.error.message });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-blue/5 text-blue border border-blue/10 sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
            <Shield className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-extrabold text-ink-strong sm:text-3xl">Xavfsizlik</h2>
            <p className="text-sm text-ink-soft opacity-80 max-w-md">
              Parolingizni yangilang va hisobingiz xavfsizligini ta'minlang.
            </p>
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-soft">
        <div className="border-b border-rim bg-tint/30 px-8 py-5">
          <h3 className="font-display text-base font-extrabold text-ink-strong flex items-center gap-2">
            <Key className="h-4.5 w-4.5 text-blue" />
            Parolni o'zgartirish
          </h3>
        </div>

        <form onSubmit={handleChangePassword} className="p-6 space-y-6">
          <div className="space-y-4 max-w-md">
            {status && (
              <div className={cn(
                'flex items-start gap-3 rounded-2xl p-4 text-sm font-medium',
                status.type === 'success'
                  ? 'bg-teal/5 border border-teal/20 text-teal'
                  : 'bg-red/5 border border-red/20 text-red'
              )}>
                {status.type === 'success'
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                  : <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                }
                {status.message}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Joriy parol</label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-4 pr-12 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-strong transition-colors"
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Yangi parol</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Yangi parolni kiriting"
                  required
                  minLength={8}
                  className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-4 pr-12 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-strong transition-colors"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPassword && newPassword.length < 8 && (
                <p className="text-xs font-medium text-red">Kamida 8 ta belgi kerak</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">Yangi parolni tasdiqlang</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Yangi parolni qayta kiriting"
                  required
                  className="w-full rounded-2xl border border-rim bg-tint/30 py-3 pl-4 pr-12 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-strong transition-colors"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs font-medium text-red">Parollar mos kelmaydi</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saqlanmoqda...
                </>
              ) : (
                'Parolni yangilash'
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
