// Task 29.2 — Session binding, device fingerprinting, adaptive auth.

export { SessionBindingService } from './session-binding.service';
export type {
  SessionBindingMeta,
  SessionValidationResult,
  TrustedDevice,
} from './session-binding.service';

export { DeviceFingerprintService } from './device-fingerprint.service';
export type {
  DeviceFingerprintComponents,
  TrustedDeviceRecord,
} from './device-fingerprint.service';

export {
  AdaptiveAuthGuard,
  RequireStepUp,
  REQUIRE_STEP_UP_KEY,
  RISK_OPERATIONS,
} from './adaptive-auth.guard';
export type {
  RiskLevel,
  StepUpMethod,
  StepUpVerification,
} from './adaptive-auth.guard';
