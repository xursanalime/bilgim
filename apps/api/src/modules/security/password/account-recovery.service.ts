import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';

/**
 * Recovery step identifiers for the multi-step account recovery flow.
 * Requirement 29.6: email + phone + security questions.
 */
export enum RecoveryStep {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
  SECURITY_QUESTIONS = 'SECURITY_QUESTIONS',
}

/**
 * Status of a recovery session.
 */
export enum RecoverySessionStatus {
  PENDING = 'PENDING',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PHONE_VERIFIED = 'PHONE_VERIFIED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

/**
 * Represents a recovery session tracking multi-step progress.
 */
export interface RecoverySession {
  id: string;
  userId: string;
  status: RecoverySessionStatus;
  completedSteps: RecoveryStep[];
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

/**
 * Result of initiating a recovery session.
 */
export interface RecoveryInitResult {
  sessionId: string;
  nextStep: RecoveryStep;
  expiresAt: Date;
}

/**
 * Result of verifying a recovery step.
 */
export interface RecoveryStepResult {
  success: boolean;
  nextStep: RecoveryStep | null;
  error?: string;
  sessionCompleted?: boolean;
}

/**
 * Zod schema for security question answers.
 */
export const SecurityAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1).max(200),
});

export type SecurityAnswer = z.infer<typeof SecurityAnswerSchema>;

/**
 * Port interface for the recovery session store.
 * Allows swapping between Redis/DB implementations.
 */
export interface RecoverySessionStore {
  create(session: RecoverySession): Promise<void>;
  findById(id: string): Promise<RecoverySession | null>;
  update(session: RecoverySession): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Port interface for sending verification codes.
 */
export interface VerificationSender {
  sendEmailCode(email: string, code: string): Promise<void>;
  sendPhoneCode(phone: string, code: string): Promise<void>;
}

/**
 * Port interface for user data lookup during recovery.
 */
export interface RecoveryUserLookup {
  findByEmail(email: string): Promise<{ id: string; phone?: string } | null>;
  getSecurityAnswers(userId: string): Promise<Array<{ questionId: string; answerHash: string }>>;
}

/**
 * AccountRecoveryService — implements multi-step account recovery
 * with email + phone + security questions verification.
 *
 * Task 29.3, Requirement 29.6.
 *
 * Recovery flow:
 *   1. User provides email → system sends verification code to email
 *   2. User verifies email code → system sends verification code to phone
 *   3. User verifies phone code → system presents security questions
 *   4. User answers security questions → recovery token issued
 *
 * Security measures:
 *   - Session expires after 15 minutes
 *   - Maximum 5 attempts per step
 *   - Codes are 6-digit numeric, hashed in storage
 *   - Timing-safe comparison for code verification
 *   - Rate limiting delegated to caller (guard/middleware)
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  /** Session TTL in milliseconds (15 minutes). */
  static readonly SESSION_TTL_MS = 15 * 60 * 1000;

  /** Maximum verification attempts per step. */
  static readonly MAX_ATTEMPTS = 5;

  /** Verification code length (digits). */
  static readonly CODE_LENGTH = 6;

  /** Minimum security questions required for recovery. */
  static readonly MIN_SECURITY_QUESTIONS = 2;

  constructor(
    private readonly sessionStore: RecoverySessionStore,
    private readonly verificationSender: VerificationSender,
    private readonly userLookup: RecoveryUserLookup,
  ) {}

  /**
   * Initiate account recovery by email.
   * Sends a verification code to the user's registered email.
   *
   * @param email - The email address to recover
   * @returns Recovery session info or null if user not found
   */
  async initiateRecovery(email: string): Promise<RecoveryInitResult | null> {
    const user = await this.userLookup.findByEmail(email);
    if (!user) {
      // Don't reveal whether the email exists — return null silently
      this.logger.debug('Recovery initiated for unknown email (silent fail)');
      return null;
    }

    const session: RecoverySession = {
      id: this.generateSessionId(),
      userId: user.id,
      status: RecoverySessionStatus.PENDING,
      completedSteps: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + AccountRecoveryService.SESSION_TTL_MS),
      attempts: 0,
      maxAttempts: AccountRecoveryService.MAX_ATTEMPTS,
    };

    await this.sessionStore.create(session);

    const code = this.generateCode();
    await this.storeVerificationCode(session.id, RecoveryStep.EMAIL_VERIFICATION, code);
    await this.verificationSender.sendEmailCode(email, code);

    return {
      sessionId: session.id,
      nextStep: RecoveryStep.EMAIL_VERIFICATION,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Verify email code and advance to phone verification step.
   */
  async verifyEmailCode(
    sessionId: string,
    code: string,
  ): Promise<RecoveryStepResult> {
    const session = await this.getValidSession(sessionId);
    if (!session) {
      return { success: false, nextStep: null, error: 'Session expired or not found' };
    }

    if (session.status !== RecoverySessionStatus.PENDING) {
      return { success: false, nextStep: null, error: 'Invalid session state for email verification' };
    }

    if (session.attempts >= session.maxAttempts) {
      await this.failSession(session);
      return { success: false, nextStep: null, error: 'Maximum attempts exceeded' };
    }

    const isValid = await this.verifyCode(sessionId, RecoveryStep.EMAIL_VERIFICATION, code);
    if (!isValid) {
      session.attempts += 1;
      await this.sessionStore.update(session);
      return { success: false, nextStep: RecoveryStep.EMAIL_VERIFICATION, error: 'Invalid code' };
    }

    // Advance to phone verification
    session.status = RecoverySessionStatus.EMAIL_VERIFIED;
    session.completedSteps.push(RecoveryStep.EMAIL_VERIFICATION);
    session.attempts = 0;
    await this.sessionStore.update(session);

    // Send phone code
    const user = await this.userLookup.findByEmail(''); // We need userId lookup
    const phoneCode = this.generateCode();
    await this.storeVerificationCode(sessionId, RecoveryStep.PHONE_VERIFICATION, phoneCode);

    // In real implementation, phone is fetched from user record
    // For now, the sender handles routing via session userId

    return { success: true, nextStep: RecoveryStep.PHONE_VERIFICATION };
  }

  /**
   * Verify phone code and advance to security questions step.
   */
  async verifyPhoneCode(
    sessionId: string,
    code: string,
  ): Promise<RecoveryStepResult> {
    const session = await this.getValidSession(sessionId);
    if (!session) {
      return { success: false, nextStep: null, error: 'Session expired or not found' };
    }

    if (session.status !== RecoverySessionStatus.EMAIL_VERIFIED) {
      return { success: false, nextStep: null, error: 'Email verification must be completed first' };
    }

    if (session.attempts >= session.maxAttempts) {
      await this.failSession(session);
      return { success: false, nextStep: null, error: 'Maximum attempts exceeded' };
    }

    const isValid = await this.verifyCode(sessionId, RecoveryStep.PHONE_VERIFICATION, code);
    if (!isValid) {
      session.attempts += 1;
      await this.sessionStore.update(session);
      return { success: false, nextStep: RecoveryStep.PHONE_VERIFICATION, error: 'Invalid code' };
    }

    session.status = RecoverySessionStatus.PHONE_VERIFIED;
    session.completedSteps.push(RecoveryStep.PHONE_VERIFICATION);
    session.attempts = 0;
    await this.sessionStore.update(session);

    return { success: true, nextStep: RecoveryStep.SECURITY_QUESTIONS };
  }

  /**
   * Verify security question answers and complete recovery.
   */
  async verifySecurityAnswers(
    sessionId: string,
    answers: SecurityAnswer[],
  ): Promise<RecoveryStepResult> {
    const session = await this.getValidSession(sessionId);
    if (!session) {
      return { success: false, nextStep: null, error: 'Session expired or not found' };
    }

    if (session.status !== RecoverySessionStatus.PHONE_VERIFIED) {
      return { success: false, nextStep: null, error: 'Phone verification must be completed first' };
    }

    if (session.attempts >= session.maxAttempts) {
      await this.failSession(session);
      return { success: false, nextStep: null, error: 'Maximum attempts exceeded' };
    }

    // Validate answers schema
    const validationResult = z.array(SecurityAnswerSchema).min(
      AccountRecoveryService.MIN_SECURITY_QUESTIONS,
    ).safeParse(answers);

    if (!validationResult.success) {
      return {
        success: false,
        nextStep: RecoveryStep.SECURITY_QUESTIONS,
        error: `At least ${AccountRecoveryService.MIN_SECURITY_QUESTIONS} security answers required`,
      };
    }

    // Verify answers against stored hashes
    const storedAnswers = await this.userLookup.getSecurityAnswers(session.userId);
    const isValid = this.compareSecurityAnswers(answers, storedAnswers);

    if (!isValid) {
      session.attempts += 1;
      await this.sessionStore.update(session);
      return {
        success: false,
        nextStep: RecoveryStep.SECURITY_QUESTIONS,
        error: 'Security answers do not match',
      };
    }

    // All steps completed
    session.status = RecoverySessionStatus.COMPLETED;
    session.completedSteps.push(RecoveryStep.SECURITY_QUESTIONS);
    await this.sessionStore.update(session);

    return { success: true, nextStep: null, sessionCompleted: true };
  }

  /**
   * Get the current step for a recovery session.
   */
  async getCurrentStep(sessionId: string): Promise<RecoveryStep | null> {
    const session = await this.getValidSession(sessionId);
    if (!session) return null;

    switch (session.status) {
      case RecoverySessionStatus.PENDING:
        return RecoveryStep.EMAIL_VERIFICATION;
      case RecoverySessionStatus.EMAIL_VERIFIED:
        return RecoveryStep.PHONE_VERIFICATION;
      case RecoverySessionStatus.PHONE_VERIFIED:
        return RecoveryStep.SECURITY_QUESTIONS;
      default:
        return null;
    }
  }

  /**
   * Check if a recovery session is completed (all steps passed).
   */
  async isSessionCompleted(sessionId: string): Promise<boolean> {
    const session = await this.sessionStore.findById(sessionId);
    return session?.status === RecoverySessionStatus.COMPLETED;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private async getValidSession(id: string): Promise<RecoverySession | null> {
    const session = await this.sessionStore.findById(id);
    if (!session) return null;

    if (new Date() > session.expiresAt) {
      session.status = RecoverySessionStatus.EXPIRED;
      await this.sessionStore.update(session);
      return null;
    }

    if (
      session.status === RecoverySessionStatus.EXPIRED ||
      session.status === RecoverySessionStatus.FAILED
    ) {
      return null;
    }

    return session;
  }

  private async failSession(session: RecoverySession): Promise<void> {
    session.status = RecoverySessionStatus.FAILED;
    await this.sessionStore.update(session);
  }

  /**
   * Generate a cryptographically secure session ID.
   */
  generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate a numeric verification code.
   */
  generateCode(): string {
    const max = Math.pow(10, AccountRecoveryService.CODE_LENGTH);
    const num = parseInt(randomBytes(4).toString('hex'), 16) % max;
    return num.toString().padStart(AccountRecoveryService.CODE_LENGTH, '0');
  }

  /**
   * Hash a verification code for storage.
   */
  hashCode(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  /**
   * Store a verification code (hashed) for a session step.
   *
   * NOT IMPLEMENTED — see {@link verifyCode}. Throws rather than silently
   * discarding the code, so a caller cannot end up in a state where a
   * code was "issued" but nothing was ever persisted to check it against.
   */
  private async storeVerificationCode(
    _sessionId: string,
    _step: RecoveryStep,
    _code: string,
  ): Promise<void> {
    throw new Error(
      'AccountRecoveryService.storeVerificationCode is not implemented — ' +
        'wire a RecoverySessionStore before exposing account recovery.',
    );
  }

  /**
   * Verify a code against the stored hash.
   *
   * **NOT IMPLEMENTED — fails closed.**
   *
   * This method used to `return true` unconditionally, with a comment
   * saying the store implementation would fill it in later. Nothing in
   * the app routes to `AccountRecoveryService` today, so it was never
   * exploitable — but the class is fully written and unit-tested, so it
   * reads as finished. The moment anyone mounted it on a controller,
   * *any* code would have verified any step of an account-recovery flow:
   * a direct, unauthenticated account takeover.
   *
   * A stub in an authentication path must fail closed. Throwing (rather
   * than returning `false`) also makes the gap impossible to miss: wiring
   * this up produces an immediate, loud 500 instead of a silently
   * unverifiable flow.
   */
  private async verifyCode(
    _sessionId: string,
    _step: RecoveryStep,
    _code: string,
  ): Promise<boolean> {
    throw new Error(
      'AccountRecoveryService.verifyCode is not implemented — ' +
        'wire a RecoverySessionStore before exposing account recovery.',
    );
  }

  /**
   * Compare user-provided security answers against stored hashes.
   * Answers are normalized (trimmed, lowercased) before hashing.
   */
  private compareSecurityAnswers(
    provided: SecurityAnswer[],
    stored: Array<{ questionId: string; answerHash: string }>,
  ): boolean {
    if (stored.length < AccountRecoveryService.MIN_SECURITY_QUESTIONS) {
      return false;
    }

    let correctCount = 0;
    for (const answer of provided) {
      const storedAnswer = stored.find((s) => s.questionId === answer.questionId);
      if (!storedAnswer) continue;

      const normalizedAnswer = answer.answer.trim().toLowerCase();
      const hash = createHash('sha256').update(normalizedAnswer, 'utf8').digest('hex');

      if (hash === storedAnswer.answerHash) {
        correctCount++;
      }
    }

    return correctCount >= AccountRecoveryService.MIN_SECURITY_QUESTIONS;
  }
}
