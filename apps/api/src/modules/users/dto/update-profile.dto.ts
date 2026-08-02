import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').trim(),
  phone: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
