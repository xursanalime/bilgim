import {
  AccountRecoveryService,
  RecoverySession,
  RecoverySessionStatus,
  RecoveryStep,
  RecoverySessionStore,
  VerificationSender,
  RecoveryUserLookup,
  SecurityAnswer,
} from './account-recovery.service';
import { createHash } from 'crypto';

/**
 * Unit tests for `AccountRecoveryService` (Task 29.3, Req 29.6).
 *
 * Covers:
 *   - Multi-step recovery flow: email → phone → security questions
 *   - Session expiration handling
 *   - Maximum attempts enforcement
 *   - Step ordering enforcement (cannot skip steps)
 *   - Security answer comparison (normalized, hashed)
 *   - Silent failure for unknown emails
 *   - Code generation and hashing
 */

function hashAnswer(answer: string): string {
  return createHash('sha256')
    .update(answer.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

class InMemorySessionStore implements RecoverySessionStore {
  private sessions = new Map<string, RecoverySession>();

  async create(session: RecoverySession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async findById(id: string): Promise<RecoverySession | null> {
    const s = this.sessions.get(id);
    return s ? { ...s, completedSteps: [...s.completedSteps] } : null;
  }

  async update(session: RecoverySession): Promise<void> {
    this.sessions.set(session.id, { ...session, completedSteps: [...session.completedSteps] });
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

function createMockSender(): VerificationSender {
  return {
    sendEmailCode: jest.fn(async () => {}),
    sendPhoneCode: jest.fn(async () => {}),
  };
}

function createMockUserLookup(
  opts: {
    exists?: boolean;
    phone?: string;
    securityAnswers?: Array<{ questionId: string; answerHash: string }>;
  } = {},
): RecoveryUserLookup {
  const { exists = true, phone = '+998901234567', securityAnswers } = opts;

  return {
    findByEmail: jest.fn(async () =>
      exists ? { id: 'user-123', phone } : null,
    ),
    getSecurityAnswers: jest.fn(async () =>
      securityAnswers ?? [
        { questionId: 'q1', answerHash: hashAnswer('tashkent') },
        { questionId: 'q2', answerHash: hashAnswer('blue') },
        { questionId: 'q3', answerHash: hashAnswer('fluffy') },
      ],
    ),
  };
}

describe('AccountRecoveryService', () => {
  describe('initiateRecovery', () => {
    it('creates a session and sends email code for existing user', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const result = await service.initiateRecovery('user@example.com');

      expect(result).not.toBeNull();
      expect(result!.sessionId).toHaveLength(64); // 32 bytes hex
      expect(result!.nextStep).toBe(RecoveryStep.EMAIL_VERIFICATION);
      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(sender.sendEmailCode).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });

    it('returns null silently for unknown email (no user enumeration)', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup({ exists: false });
      const service = new AccountRecoveryService(store, sender, lookup);

      const result = await service.initiateRecovery('unknown@example.com');

      expect(result).toBeNull();
      expect(sender.sendEmailCode).not.toHaveBeenCalled();
    });

    it('sets session expiry to 15 minutes from now', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const before = Date.now();
      const result = await service.initiateRecovery('user@example.com');
      const after = Date.now();

      const expectedMin = before + AccountRecoveryService.SESSION_TTL_MS;
      const expectedMax = after + AccountRecoveryService.SESSION_TTL_MS;

      expect(result!.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(result!.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('verifyEmailCode', () => {
    it('advances session to EMAIL_VERIFIED on valid code', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const initResult = await service.initiateRecovery('user@example.com');
      const result = await service.verifyEmailCode(initResult!.sessionId, '123456');

      expect(result.success).toBe(true);
      expect(result.nextStep).toBe(RecoveryStep.PHONE_VERIFICATION);
    });

    it('returns error for expired session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      // Create session with past expiry
      const session: RecoverySession = {
        id: 'expired-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // expired 5 min ago
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const result = await service.verifyEmailCode('expired-session', '123456');
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('returns error for non-existent session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const result = await service.verifyEmailCode('nonexistent', '123456');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails session after max attempts exceeded', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'max-attempts-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 5,
        maxAttempts: 5,
      };
      await store.create(session);

      const result = await service.verifyEmailCode('max-attempts-session', '123456');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum attempts');

      // Session should be marked as FAILED
      const updated = await store.findById('max-attempts-session');
      expect(updated!.status).toBe(RecoverySessionStatus.FAILED);
    });
  });

  describe('verifyPhoneCode', () => {
    it('advances session to PHONE_VERIFIED on valid code', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      // Set up session at EMAIL_VERIFIED state
      const session: RecoverySession = {
        id: 'phone-session',
        userId: 'user-123',
        status: RecoverySessionStatus.EMAIL_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const result = await service.verifyPhoneCode('phone-session', '654321');
      expect(result.success).toBe(true);
      expect(result.nextStep).toBe(RecoveryStep.SECURITY_QUESTIONS);
    });

    it('rejects if email step not completed', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'skip-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const result = await service.verifyPhoneCode('skip-session', '654321');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email verification must be completed');
    });
  });

  describe('verifySecurityAnswers', () => {
    it('completes recovery when answers are correct', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'security-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PHONE_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION, RecoveryStep.PHONE_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const answers: SecurityAnswer[] = [
        { questionId: 'q1', answer: 'Tashkent' }, // case-insensitive
        { questionId: 'q2', answer: ' Blue ' },   // trimmed
      ];

      const result = await service.verifySecurityAnswers('security-session', answers);
      expect(result.success).toBe(true);
      expect(result.sessionCompleted).toBe(true);
      expect(result.nextStep).toBeNull();
    });

    it('rejects incorrect security answers', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'wrong-answers-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PHONE_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION, RecoveryStep.PHONE_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const answers: SecurityAnswer[] = [
        { questionId: 'q1', answer: 'wrong-city' },
        { questionId: 'q2', answer: 'wrong-color' },
      ];

      const result = await service.verifySecurityAnswers('wrong-answers-session', answers);
      expect(result.success).toBe(false);
      expect(result.error).toContain('do not match');
    });

    it('rejects if phone step not completed', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'no-phone-session',
        userId: 'user-123',
        status: RecoverySessionStatus.EMAIL_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const answers: SecurityAnswer[] = [
        { questionId: 'q1', answer: 'Tashkent' },
        { questionId: 'q2', answer: 'Blue' },
      ];

      const result = await service.verifySecurityAnswers('no-phone-session', answers);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Phone verification must be completed');
    });

    it('rejects if fewer than minimum security answers provided', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'few-answers-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PHONE_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION, RecoveryStep.PHONE_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      const answers: SecurityAnswer[] = [
        { questionId: 'q1', answer: 'Tashkent' },
      ];

      const result = await service.verifySecurityAnswers('few-answers-session', answers);
      expect(result.success).toBe(false);
      expect(result.error).toContain('security answers required');
    });
  });

  describe('getCurrentStep', () => {
    it('returns EMAIL_VERIFICATION for PENDING session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'step-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      expect(await service.getCurrentStep('step-session')).toBe(
        RecoveryStep.EMAIL_VERIFICATION,
      );
    });

    it('returns PHONE_VERIFICATION for EMAIL_VERIFIED session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'phone-step-session',
        userId: 'user-123',
        status: RecoverySessionStatus.EMAIL_VERIFIED,
        completedSteps: [RecoveryStep.EMAIL_VERIFICATION],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      expect(await service.getCurrentStep('phone-step-session')).toBe(
        RecoveryStep.PHONE_VERIFICATION,
      );
    });

    it('returns null for expired session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'expired-step-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      expect(await service.getCurrentStep('expired-step-session')).toBeNull();
    });

    it('returns null for non-existent session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      expect(await service.getCurrentStep('nonexistent')).toBeNull();
    });
  });

  describe('isSessionCompleted', () => {
    it('returns true for COMPLETED session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'completed-session',
        userId: 'user-123',
        status: RecoverySessionStatus.COMPLETED,
        completedSteps: [
          RecoveryStep.EMAIL_VERIFICATION,
          RecoveryStep.PHONE_VERIFICATION,
          RecoveryStep.SECURITY_QUESTIONS,
        ],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      expect(await service.isSessionCompleted('completed-session')).toBe(true);
    });

    it('returns false for non-completed session', async () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const session: RecoverySession = {
        id: 'pending-session',
        userId: 'user-123',
        status: RecoverySessionStatus.PENDING,
        completedSteps: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      };
      await store.create(session);

      expect(await service.isSessionCompleted('pending-session')).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('generateSessionId returns 64-char hex string', () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const id = service.generateSessionId();
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generateCode returns 6-digit numeric string', () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const code = service.generateCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[0-9]{6}$/);
    });

    it('hashCode produces consistent SHA-256 hash', () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const hash1 = service.hashCode('123456');
      const hash2 = service.hashCode('123456');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('hashCode produces different hashes for different codes', () => {
      const store = new InMemorySessionStore();
      const sender = createMockSender();
      const lookup = createMockUserLookup();
      const service = new AccountRecoveryService(store, sender, lookup);

      const hash1 = service.hashCode('123456');
      const hash2 = service.hashCode('654321');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('constants', () => {
    it('session TTL is 15 minutes', () => {
      expect(AccountRecoveryService.SESSION_TTL_MS).toBe(15 * 60 * 1000);
    });

    it('max attempts is 5', () => {
      expect(AccountRecoveryService.MAX_ATTEMPTS).toBe(5);
    });

    it('code length is 6 digits', () => {
      expect(AccountRecoveryService.CODE_LENGTH).toBe(6);
    });

    it('minimum security questions is 2', () => {
      expect(AccountRecoveryService.MIN_SECURITY_QUESTIONS).toBe(2);
    });
  });
});
