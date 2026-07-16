export { HomeworkModule } from './homework.module';
export {
  HomeworkService,
  SPECIALTY_MODULE_ACTIVE_CAP,
} from './homework.service';
export { AssignmentService } from './assignment.service';
export { SubmissionService } from './submission.service';
export {
  AiGradingService,
  MockAiAdapter,
  AI_GRADING_PORT,
  AI_LIKELIHOOD_FLAG_THRESHOLD,
  AI_FEEDBACK_AUTHOR_TYPE,
} from './ai-grading.service';
export type {
  AiGradingPort,
  ModuleGradeInput,
  ModuleGradeResult,
  AiTextDetectionResult,
  PrecheckResult,
} from './ai-grading.service';
export {
  AiGradingProcessor,
  AI_GRADING_JOB_NAME,
} from './workers/ai-grading.processor';
export type {
  AiGradingJob,
  AiGradingJobResult,
} from './workers/ai-grading.processor';
export { SpecialtyModuleRepository } from './repositories/specialty-module.repository';
export { AssignmentRepository } from './repositories/assignment.repository';
export { SubmissionRepository } from './repositories/submission.repository';
export {
  HomeworkModuleRuntimeRegistry,
  WritingRuntime,
  WritingConfigSchema,
  WritingAnswerSchema,
  ReadingRuntime,
  ReadingConfigSchema,
  ReadingAnswerSchema,
  scoreReadingQuestion,
  HomeworkRuntimeError,
  countWords,
  writingRuntime,
  readingRuntime,
} from './runtimes';
export type {
  HomeworkModuleRuntime,
  AiPromptInputs,
  HomeworkRuntimeErrorCode,
  WritingConfig,
  WritingAnswer,
  ReadingConfig,
  ReadingAnswer,
  ReadingQuestion,
  ReadingQuestionScore,
} from './runtimes';
export {
  HomeworkModuleTypeSchema,
  BulkUpsertSpecialtyModulesSchema,
  ListAvailableModulesQuerySchema,
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  AssignmentModuleInputSchema,
  CreateSubmissionSchema,
  UpdateSubmissionAnswersSchema,
  SubmitSubmissionSchema,
  GradeSubmissionSchema,
  ReturnSubmissionSchema,
} from './dto';
export type {
  HomeworkModuleTypeLiteral,
  BulkUpsertSpecialtyModulesDto,
  ListAvailableModulesQueryDto,
  CreateAssignmentDto,
  UpdateAssignmentDto,
  AssignmentModuleInputDto,
  CreateSubmissionDto,
  UpdateSubmissionAnswersDto,
  SubmitSubmissionDto,
  GradeSubmissionDto,
  ReturnSubmissionDto,
} from './dto';
