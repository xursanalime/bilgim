import { z } from 'zod';

export const SearchUsersSchema = z.object({
  q: z.string().min(2, 'Username must be at least 2 characters'),
});

export type SearchUsersDto = z.infer<typeof SearchUsersSchema>;
