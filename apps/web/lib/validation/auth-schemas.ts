/**
 * Shared Zod schemas for client-side auth form validation.
 * Mirrors the backend DTOs in apps/api/src/modules/auth/dto/* so that
 * client + server validation rules stay in sync.
 *
 * Error messages are written in O'zbek to match the user-facing UI.
 */

import { z } from 'zod';

const emailSchema = z
  .string({ required_error: 'Email manzilini kiriting' })
  .min(1, 'Email manzilini kiriting')
  .email('Email manzili noto‘g‘ri formatda')
  .toLowerCase()
  .trim();

const passwordSchema = z
  .string({ required_error: 'Parolni kiriting' })
  .min(8, 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak')
  .regex(/[A-Za-z]/, 'Parolda kamida bitta harf bo‘lishi kerak')
  .regex(/[0-9]/, 'Parolda kamida bitta raqam bo‘lishi kerak');

export const LoginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Parolni kiriting'),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginFormValues = z.infer<typeof LoginFormSchema>;

export const RegisterFormSchema = z
  .object({
    fullName: z
      .string({ required_error: 'To‘liq ismingizni kiriting' })
      .min(2, 'Ism kamida 2 ta belgidan iborat bo‘lishi kerak')
      .max(120, 'Ism juda uzun')
      .trim(),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Parolni qayta kiriting'),
    role: z.enum(['STUDENT', 'TEACHER'], {
      errorMap: () => ({ message: 'Rolni tanlang' }),
    }),
    acceptTerms: z.literal<boolean>(true, {
      errorMap: () => ({
        message: 'Davom etish uchun shartlarga rozi bo‘ling',
      }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Parollar mos kelmadi',
    path: ['confirmPassword'],
  });

export type RegisterFormValues = z.infer<typeof RegisterFormSchema>;

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordValues = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Token noto‘g‘ri'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Parolni qayta kiriting'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Parollar mos kelmadi',
    path: ['confirmPassword'],
  });

export type ResetPasswordValues = z.infer<typeof ResetPasswordSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token noto‘g‘ri'),
});

export type VerifyEmailValues = z.infer<typeof VerifyEmailSchema>;

/**
 * Compute a rough password strength score from 0..4.
 * - +1 for length >= 8
 * - +1 for length >= 12
 * - +1 if has both lowercase and uppercase OR digits
 * - +1 if has special character
 */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'empty' | 'weak' | 'fair' | 'good' | 'strong';
} {
  if (!password) return { score: 0, label: 'empty' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const mix = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
  if (mix >= 2) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  const labels = ['empty', 'weak', 'fair', 'good', 'strong'] as const;
  return { score: clamped, label: labels[clamped] };
}
