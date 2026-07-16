export { SpeakingModule } from './speaking.module';
export {
  SpeakingService,
  type SpeakingActor,
  type SpeakingAudioSubmission,
} from './speaking.service';
export {
  SpeakingScoringService,
  type SpeakingScoringActor,
  type SpeakingScoreOutcome,
} from './speaking-scoring.service';
export { SpeakingController } from './speaking.controller';
export {
  SpeakingSubmissionRepository,
  type SpeakingModuleContext,
  type SpeakingScoringContext,
} from './repositories/speaking-submission.repository';
export {
  SubmitSpeakingAudioSchema,
  type SubmitSpeakingAudioDto,
  OverrideSpeakingScoreSchema,
  type OverrideSpeakingScoreDto,
} from './dto';
export {
  SPEAKING_MODULE_TYPES,
  SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES,
  SPEAKING_AUDIO_MAX_SIZE_BYTES,
  isAllowedSpeakingAudioContentType,
  isSpeakingModuleType,
  type SpeakingModuleType,
  type SpeakingAudioAnswer,
} from './speaking.types';
export {
  SPEAKING_AI_DRAFT_AUTHOR_TYPE,
  SPEAKING_TEACHER_AUTHOR_TYPE,
  SPEAKING_SCORING_PORT,
  SPEAKING_SCORING_JOB_NAME,
  type SpeakingScoringPort,
  type SpeakingScoringJob,
  type SpeakingScoreInput,
  type SpeakingScoreResult,
  type SpeakingAiDraftPayload,
} from './speaking-scoring.types';
export { MockSpeakingScoringAdapter } from './adapters/mock-speaking-scoring.adapter';
export { TbdSpeakingScoringAdapter } from './adapters/tbd-speaking-scoring.adapter';
export {
  SpeakingScoringProcessor,
} from './workers/speaking-scoring.processor';
