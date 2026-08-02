import { z } from 'zod';

/**
 * Registration DTO — Zod schema for POST /auth/register.
 * Validates email, username (3-30 chars, lowercase letters/numbers/underscore),
 * password (min 8 chars), fullName, and role (STUDENT | TEACHER).
 */
export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(
      /^[a-z0-9_]+$/,
      'Username can only contain lowercase letters, numbers, and underscores',
    )
    .toLowerCase()
    .trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required').trim(),
  role: z.enum(['STUDENT', 'TEACHER'], {
    errorMap: () => ({ message: 'Role must be STUDENT or TEACHER' }),
  }),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
