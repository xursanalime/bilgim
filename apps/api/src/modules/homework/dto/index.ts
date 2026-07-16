export {
  HomeworkModuleTypeSchema,
  BulkUpsertSpecialtyModulesSchema,
  ListAvailableModulesQuerySchema,
  type HomeworkModuleTypeLiteral,
  type BulkUpsertSpecialtyModulesDto,
  type ListAvailableModulesQueryDto,
} from './specialty-module.dto';

export {
  AssignmentModuleInputSchema,
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  type AssignmentModuleInputDto,
  type CreateAssignmentDto,
  type UpdateAssignmentDto,
} from './assignment.dto';

export {
  CreateSubmissionSchema,
  UpdateSubmissionAnswersSchema,
  SubmitSubmissionSchema,
  GradeSubmissionSchema,
  ReturnSubmissionSchema,
  GetMySubmissionQuerySchema,
  FeedbackEntrySchema,
  type CreateSubmissionDto,
  type UpdateSubmissionAnswersDto,
  type SubmitSubmissionDto,
  type GradeSubmissionDto,
  type ReturnSubmissionDto,
  type GetMySubmissionQueryDto,
  type FeedbackEntryDto,
} from './submission.dto';
