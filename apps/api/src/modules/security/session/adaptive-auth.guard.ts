import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Risk levels for operations that may require step-up authentication.
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Metadata key for the `@RequireStepUp()` decorator.
 */
export const REQUIRE_STEP_UP_KEY = 'security:require-step-up';

/**
 * Decorator to mark a route handler as requiring step-up authentication.
 * Used on high-risk operations like payment, password change, admin actions.
 *
 * @param riskLevel - The risk level of the operation (default: HIGH).
 *
 * @example
 * ```ts
 * @RequireStepUp('HIGH')
 * @Post('change-password')
 * async changePassword(@Body() dto: ChangePasswordDto) { ... }
 * ```
 */
export const RequireStepUp = (riskLevel: RiskLevel = 'HIGH') =>
  SetMetadata(REQUIRE_STEP_UP_KEY, riskLevel);

/**
 * Step-up verification record stored in Redis.
 * Created when the user successfully completes a step-up challenge.
 */
export interface StepUpVerification {
  /** User ID who completed the step-up. */
  userId: string;
  /** When the step-up was completed (epoch ms). */
  verifiedAt: number;
  /** The method used for step-up (MFA, password re-entry, etc.). */
  method: StepUpMethod;
  /** The risk level this verification satisfies. */
  satisfiesLevel: RiskLevel;
}

/**
 * Methods that can satisfy a step-up authentication challenge.
 */
export type StepUpMethod = 'MFA_TOTP' | 'MFA_SMS' | 'PASSWORD_REENTRY' | 'WEBAUTHN' | 'EMAIL_OTP';

/** Redis key prefix for step-up verification records. */
const STEP_UP_PREFIX = 'session:step-up:';

/**
 * TTL for step-up verifications by risk level (in seconds).
 * Higher risk = shorter validity window.
 */
const STEP_UP_TTL: Record<RiskLevel, number> = {
  LOW: 60 * 60, // 1 hour
  MEDIUM: 30 * 60, // 30 minutes
  HIGH: 10 * 60, // 10 minutes
  CRITICAL: 5 * 60, // 5 minutes
};

/**
 * Operations categorized by risk level for adaptive authentication.
 */
export const RISK_OPERATIONS: Record<string, RiskLevel> = {
  // CRITICAL — admin operations
  'admin:user:suspend': 'CRITICAL',
  'admin:user:delete': 'CRITICAL',
  'admin:system:config': 'CRITICAL',

  // HIGH — sensitive user operations
  'user:password:change': 'HIGH',
  'user:email:change': 'HIGH',
  'user:mfa:disable': 'HIGH',
  'billing:payment:create': 'HIGH',
  'billing:refund:create': 'HIGH',

  // MEDIUM — moderate risk
  'user:profile:delete': 'MEDIUM',
  'user:devices:clear': 'MEDIUM',
  'billing:subscription:cancel': 'MEDIUM',

  // LOW — standard operations that still benefit from step-up
  'user:sessions:revoke-all': 'LOW',
};

/**
 * Request shape expected by the guard.
 */
interface AdaptiveAuthRequest {
  user?: { id?: string; sub?: string; role?: string };
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  path?: string;
  method?: string;
}

/**
 * `AdaptiveAuthGuard` — Task 29.2 (Requirement 29.4).
 *
 * Implements risk-based step-up authentication for high-risk operations.
 * When a route is decorated with `@RequireStepUp(level)`, this guard
 * checks whether the user has a valid step-up verification at or above
 * the required risk level. If not, it returns 403 with a
 * `STEP_UP_REQUIRED` code, prompting the client to complete an
 * additional authentication challenge.
 *
 * ## How it works:
 * 1. Route handler is decorated with `@RequireStepUp('HIGH')`.
 * 2. Guard checks Redis for a valid step-up record for the user.
 * 3. If found and not expired → request proceeds.
 * 4. If not found or expired → 403 STEP_UP_REQUIRED is thrown.
 * 5. Client completes MFA/password re-entry → calls step-up endpoint.
 * 6. On success, a step-up record is stored in Redis with TTL.
 * 7. Client retries the original request → guard passes.
 */
@Injectable()
export class AdaptiveAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdaptiveAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only applies to HTTP requests
    if (context.getType() !== 'http') return true;

    // Check if the handler or controller has @RequireStepUp metadata
    const requiredLevel = this.reflector.getAllAndOverride<RiskLevel | undefined>(
      REQUIRE_STEP_UP_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No step-up required for this route
    if (!requiredLevel) return true;

    // If Redis is unavailable, fail-open (don't block legitimate users)
    if (!this.redis) return true;

    const request = context.switchToHttp().getRequest<AdaptiveAuthRequest>();
    const userId = request.user?.id ?? request.user?.sub;

    if (!userId) {
      // No authenticated user — let the auth guard handle this
      return true;
    }

    // Check for a valid step-up verification
    const verification = await this.getStepUpVerification(userId);

    if (!verification) {
      this.logger.warn(
        `Step-up required for user=${userId}, level=${requiredLevel}, path=${request.path}`,
      );
      throw new HttpException(
        {
          code: 'STEP_UP_REQUIRED',
          message: 'This operation requires additional authentication.',
          details: {
            requiredLevel,
            ttl: STEP_UP_TTL[requiredLevel],
            acceptedMethods: this.getAcceptedMethods(requiredLevel),
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Check if the verification level satisfies the requirement
    if (!this.levelSatisfies(verification.satisfiesLevel, requiredLevel)) {
      this.logger.warn(
        `Step-up level insufficient: user=${userId}, has=${verification.satisfiesLevel}, needs=${requiredLevel}`,
      );
      throw new HttpException(
        {
          code: 'STEP_UP_INSUFFICIENT',
          message: 'A higher authentication level is required for this operation.',
          details: {
            currentLevel: verification.satisfiesLevel,
            requiredLevel,
            acceptedMethods: this.getAcceptedMethods(requiredLevel),
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }

  // ─── Step-Up Verification Management ──────────────────────────

  /**
   * Record a successful step-up authentication.
   * Called by the step-up endpoint after the user completes the challenge.
   */
  async recordStepUp(
    userId: string,
    method: StepUpMethod,
    satisfiesLevel: RiskLevel,
  ): Promise<void> {
    if (!this.redis) return;

    const key = `${STEP_UP_PREFIX}${userId}`;
    const verification: StepUpVerification = {
      userId,
      verifiedAt: Date.now(),
      method,
      satisfiesLevel,
    };

    const ttl = STEP_UP_TTL[satisfiesLevel];
    await this.redis.set(key, JSON.stringify(verification), ttl);

    this.logger.debug(
      `Step-up recorded: user=${userId}, method=${method}, level=${satisfiesLevel}, ttl=${ttl}s`,
    );
  }

  /**
   * Get the current step-up verification for a user (if any).
   */
  async getStepUpVerification(userId: string): Promise<StepUpVerification | null> {
    if (!this.redis) return null;

    const key = `${STEP_UP_PREFIX}${userId}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const verification: StepUpVerification = JSON.parse(raw);
    return verification;
  }

  /**
   * Invalidate a user's step-up verification (e.g. on logout).
   */
  async invalidateStepUp(userId: string): Promise<void> {
    if (!this.redis) return;
    const key = `${STEP_UP_PREFIX}${userId}`;
    await this.redis.del(key);
  }

  // ─── Private Helpers ───────────────────────────────────────────

  /**
   * Check if a given level satisfies the required level.
   * CRITICAL > HIGH > MEDIUM > LOW.
   */
  private levelSatisfies(has: RiskLevel, needs: RiskLevel): boolean {
    const order: Record<RiskLevel, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };
    return order[has] >= order[needs];
  }

  /**
   * Get accepted step-up methods for a given risk level.
   * Higher risk levels require stronger methods.
   */
  private getAcceptedMethods(level: RiskLevel): StepUpMethod[] {
    switch (level) {
      case 'CRITICAL':
        return ['WEBAUTHN', 'MFA_TOTP'];
      case 'HIGH':
        return ['WEBAUTHN', 'MFA_TOTP', 'MFA_SMS', 'PASSWORD_REENTRY'];
      case 'MEDIUM':
        return ['WEBAUTHN', 'MFA_TOTP', 'MFA_SMS', 'PASSWORD_REENTRY', 'EMAIL_OTP'];
      case 'LOW':
      default:
        return ['WEBAUTHN', 'MFA_TOTP', 'MFA_SMS', 'PASSWORD_REENTRY', 'EMAIL_OTP'];
    }
  }
}
