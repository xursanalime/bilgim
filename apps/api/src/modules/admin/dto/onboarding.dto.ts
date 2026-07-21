import { z } from 'zod';

export const CreateOnboardingQuestionDtoSchema = z.object({
  specialtyId: z.string().uuid().optional().nullable(),
  order: z.number().int(),
  textUz: z.string().min(1),
  textRu: z.string().min(1),
  textEn: z.string().min(1),
  optionsJson: z.any(),
  isActive: z.boolean().optional(),
});

export type CreateOnboardingQuestionDto = z.infer<typeof CreateOnboardingQuestionDtoSchema>;

export const UpdateOnboardingQuestionDtoSchema = CreateOnboardingQuestionDtoSchema.partial();

export type UpdateOnboardingQuestionDto = z.infer<typeof UpdateOnboardingQuestionDtoSchema>;
