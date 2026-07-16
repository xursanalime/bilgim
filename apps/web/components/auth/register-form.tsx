'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';

import { FormField } from '../ui/form-field';
import { Button } from '../ui/button';
import { HCaptchaWidget } from './hcaptcha-widget';
import { authApi } from '../../lib/auth-api';
import { ApiClientError } from '../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../lib/auth-errors';

const RegisterSchema = z
  .object({
    fullName: z.string().min(2, 'Ism kamida 2 ta belgidan iborat'),
    username: z
      .string()
      .min(3, 'Username kamida 3 ta belgi')
      .max(30, 'Username 30 belgidan oshmasin')
      .regex(
        /^[a-z0-9_]+$/,
        'Faqat kichik harf, raqam va pastki chiziq (_)',
      ),
    email: z.string().email('Email noto\'g\'ri formatda'),
    password: z.string().min(8, 'Parol kamida 8 ta belgi bo\'lishi kerak'),
    confirmPassword: z.string(),
    role: z.enum(['STUDENT', 'TEACHER']),
    terms: z.literal(true, {
      errorMap: () => ({ message: 'Shartlarni qabul qilishingiz kerak' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parollar mos kelmadi',
  });

type RegisterFormValues = z.infer<typeof RegisterSchema>;
type Role = 'STUDENT' | 'TEACHER';
type Step = 'onboarding' | 'form';

interface RegisterFormProps {
  locale: string;
  initialRole: 'STUDENT' | 'TEACHER';
  callbackUrl?: string;
}

export function RegisterForm({ locale, initialRole, callbackUrl }: RegisterFormProps) {
  const router = useRouter();
  
  // If coming from an invite link, force 'STUDENT' role and skip onboarding
  const isInvite = !!callbackUrl;
  const forcedRole = isInvite ? 'STUDENT' : initialRole;
  
  const [step, setStep] = useState<Step>(isInvite ? 'form' : 'onboarding');
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string } | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { role: forcedRole },
  });

  const role = watch('role');

  const chooseRole = (r: Role) => {
    setValue('role', r);
    setStep('form');
  };

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    if (captchaRequired && !hCaptchaToken) {
      setServerError(getAuthErrorMessage('CAPTCHA_REQUIRED', { locale }));
      return;
    }
    try {
      await authApi.register({
        email: values.email,
        username: values.username,
        password: values.password,
        fullName: values.fullName,
        role: values.role,
        ...(hCaptchaToken ? { hCaptchaToken } : {}),
      });
      setSuccess({ email: values.email });
    } catch (error) {
      if (error instanceof ApiClientError) {
        const code = extractErrorCode(error.details);
        if (code === 'CAPTCHA_REQUIRED') {
          setCaptchaRequired(true);
          setHCaptchaToken(null);
        }
        setServerError(getAuthErrorMessage(code, { locale, fallback: error.message }));
      } else {
        setServerError(getAuthErrorMessage('NETWORK_ERROR', { locale }));
      }
    }
  };

  // ── Success state ──────────────────────────────────────────────
  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-tint ring-1 ring-inset ring-green/30">
          <svg
            className="h-10 w-10 text-green"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2
            className="text-2xl font-extrabold tracking-tight text-ink-strong"
            style={{ letterSpacing: '-0.02em' }}
          >
            Email yuborildi
          </h2>
          <p className="text-ink-soft">
            <span className="font-semibold text-ink-strong">{success.email}</span>{' '}
            manziliga tasdiqlash havolasini yubordik. Pochta qutingizni
            tekshiring va havolani bosing.
          </p>
        </div>
        <div className="rounded-2xl border border-rim bg-tint p-4 text-left text-sm text-ink-soft">
          <p className="text-sm font-bold text-ink-strong">
            Email kelmadi?
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Spam jildni tekshiring</li>
            <li>2-3 daqiqa kuting</li>
            <li>Email manzili to&apos;g&apos;ri yozilganligini tekshiring</li>
          </ul>
        </div>
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => {
            const url = callbackUrl ? `/${locale}/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : `/${locale}/login`;
            router.push(url);
          }}
        >
          Kirish sahifasiga o&apos;tish
        </Button>
      </div>
    );
  }

  // ── Step 1: Onboarding — role selection ────────────────────────
  if (step === 'onboarding') {
    return (
      <motion.div
        key="onboarding"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-4"
      >
        <p className="text-sm font-semibold text-ink-strong">
          Avval o&apos;zingizni tanlang
        </p>

        <RoleCard
          active={role === 'TEACHER'}
          onClick={() => chooseRole('TEACHER')}
          title="Men o'qituvchiman"
          desc="Ingliz tili kurslarini yarataman, jonli dars o'tkazaman, vazifa beraman va to'lov qabul qilaman."
          tone="blue"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
          }
        />

        <RoleCard
          active={role === 'STUDENT'}
          onClick={() => chooseRole('STUDENT')}
          title="Men o'quvchiman"
          desc="Ingliz tili kurslariga qo'shilaman, jonli darslarni ko'raman va AI yordamchi bilan o'rganaman."
          tone="green"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          }
        />

        <p className="pt-2 text-center text-xs text-ink-soft">
          Keyinroq o&apos;zgartira olmaysiz, shuning uchun to&apos;g&apos;ri tanlang.
        </p>
      </motion.div>
    );
  }

  // ── Step 2: Form ───────────────────────────────────────────────
  return (
    <AnimatePresence mode="wait">
      <motion.form
        key="form"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        {/* Selected-role banner with change button */}
        <div className="flex items-center justify-between rounded-2xl border border-rim bg-tint px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                role === 'TEACHER' ? 'bg-blue-tint text-blue' : 'bg-green-tint text-green'
              }`}
            >
              {role === 'TEACHER' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
              )}
            </span>
            <div>
              <p className="text-sm font-bold text-ink-strong">
                {role === 'TEACHER' ? "O'qituvchi" : "O'quvchi"}
              </p>
              <p className="text-xs text-ink-soft">Tanlangan rol</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStep('onboarding')}
            disabled={isInvite}
            className={`text-xs font-semibold text-blue underline-offset-4 hover:underline ${isInvite ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            O&apos;zgartirish
          </button>
        </div>

        {serverError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red"
          >
            {serverError}
          </div>
        )}

        <FormField
          id="fullName"
          label="To'liq ism"
          type="text"
          autoComplete="name"
          required
          placeholder="Sefer Aliyev"
          error={errors.fullName?.message}
          {...register('fullName')}
        />

        <FormField
          id="username"
          label="Username"
          type="text"
          autoComplete="username"
          required
          placeholder="sefer_aliyev"
          helperText="Profil URL: bilgim.uz/@username"
          leftIcon={<span className="text-ink-faint">@</span>}
          error={errors.username?.message}
          {...register('username')}
        />

        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          placeholder="siz@misol.uz"
          error={errors.email?.message}
          {...register('email')}
        />

        <FormField
          id="password"
          label="Parol"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          placeholder="Kamida 8 belgi"
          helperText="Kuchli parol uchun harf, raqam va maxsus belgi qo'shing"
          error={errors.password?.message}
          rightIcon={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="pointer-events-auto text-ink-faint transition-colors hover:text-ink-strong"
              aria-label={showPassword ? "Parolni yashirish" : "Parolni ko'rsatish"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          }
          {...register('password')}
        />

        <FormField
          id="confirmPassword"
          label="Parolni tasdiqlang"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          placeholder="Parolni qaytadan kiriting"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-rim accent-blue"
            {...register('terms')}
          />
          <span className="text-ink-soft">
            Men{' '}
            <a
              href={`/${locale}/legal/terms`}
              target="_blank"
              rel="noopener"
              className="font-semibold text-blue underline-offset-4 hover:underline"
            >
              foydalanish shartlari
            </a>{' '}
            va{' '}
            <a
              href={`/${locale}/legal/privacy`}
              target="_blank"
              rel="noopener"
              className="font-semibold text-blue underline-offset-4 hover:underline"
            >
              maxfiylik siyosati
            </a>
            ni qabul qilaman
          </span>
        </label>
        {errors.terms && (
          <p className="text-xs text-red">{errors.terms.message}</p>
        )}

        {captchaRequired && (
          <HCaptchaWidget
            id="register-captcha"
            onVerify={setHCaptchaToken}
            onExpire={() => setHCaptchaToken(null)}
          />
        )}

        <Button
          type="submit"
          loading={isSubmitting}
          disabled={captchaRequired && !hCaptchaToken}
          fullWidth
          size="lg"
        >
          Hisob yaratish
        </Button>
      </motion.form>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────
// RoleCard — large onboarding choice card
// ─────────────────────────────────────────────────────────────────

function RoleCard({
  active,
  onClick,
  title,
  desc,
  tone,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  tone: 'blue' | 'green';
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === 'blue'
      ? { iconBg: 'bg-blue-tint text-blue', ring: 'border-blue/40 bg-blue/[0.04]' }
      : { iconBg: 'bg-green-tint text-green', ring: 'border-green/40 bg-green/[0.04]' };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-medium ${
        active ? toneClass.ring : 'border-rim bg-canvas hover:border-rim-2'
      }`}
    >
      <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${toneClass.iconBg}`}>
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-base font-extrabold text-ink-strong" style={{ letterSpacing: '-0.02em' }}>
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{desc}</p>
      </div>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-tint text-ink-soft transition-all group-hover:bg-blue group-hover:text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </span>
    </button>
  );
}

function Eye() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
