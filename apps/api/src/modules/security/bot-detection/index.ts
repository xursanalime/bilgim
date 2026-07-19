/**
 * Bot detection — Task 27.4 (Req 27.6).
 *
 * Public surface re-exported from the parent module barrel
 * (`apps/api/src/modules/security/index.ts`) so call sites can
 * import everything from `'../security'`:
 *
 *   - `BotDetectionService` — per-request scoring + decision.
 *   - `BotDetectionGuard` + `RequireBotCheck` — opt-in route guard.
 *   - `FingerprintService` — fingerprint cardinality tracker.
 *   - `BehavioralService` — behavioural summary collector.
 *   - `BotDetectionController` — POST endpoints for the browser
 *     collectors.
 */
export { BotDetectionService } from './bot-detection.service';
export { BotDetectionGuard } from './bot-detection.guard';
export { BotDetectionController } from './bot-detection.controller';
export { BehavioralService } from './behavioral.service';
export { FingerprintService } from './fingerprint.service';
export {
  RequireBotCheck,
  REQUIRE_BOT_CHECK_KEY,
} from './require-bot-check.decorator';
export {
  BehaviorReportSchema,
  type BehaviorReportDto,
  FingerprintReportSchema,
  type FingerprintReportDto,
} from './dto';
export type {
  BotDetectionRequest,
  BotDecision,
  BotEvaluation,
  BehavioralSignals,
  StoredBehavioralSummary,
  DeviceFingerprintPayload,
  FingerprintAnomalyResult,
} from './types';
