import { z } from 'zod';

export const UpdateSystemSettingDtoSchema = z.object({
  value: z.any(),
  description: z.string().optional(),
});

export type UpdateSystemSettingDto = z.infer<typeof UpdateSystemSettingDtoSchema>;
