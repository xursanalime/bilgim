import { z } from 'zod';
import { AiIntent } from '@prisma/client';

export const CreateAiPromptTemplateDtoSchema = z.object({
  key: z.string().min(1),
  intent: z.nativeEnum(AiIntent),
  systemText: z.string().min(1),
  userTemplate: z.string().min(1),
  modelName: z.string().optional(),
  maxTokens: z.number().optional(),
  isActive: z.boolean().optional(),
});

export type CreateAiPromptTemplateDto = z.infer<typeof CreateAiPromptTemplateDtoSchema>;

export const UpdateAiPromptTemplateDtoSchema = CreateAiPromptTemplateDtoSchema.partial().omit({ key: true });

export type UpdateAiPromptTemplateDto = z.infer<typeof UpdateAiPromptTemplateDtoSchema>;
