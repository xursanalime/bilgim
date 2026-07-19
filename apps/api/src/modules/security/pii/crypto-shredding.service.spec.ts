import {
  CryptoShreddingService,
  type UserKeyStore,
  type ShreddingAuditEntry,
} from './crypto-shredding.service';
import fc from 'fast-check';

describe('CryptoShreddingService', () => {
  let service: CryptoShreddingService;
  let mockKeyStore: jest.Mocked<UserKeyStore>;
  let auditLog: ShreddingAuditEntry[];

  beforeEach(() => {
    auditLog = [];
    mockKeyStore = {
      getKeyIdsForUser: jest.fn(),
      destroyKey: jest.fn(),
      recordAudit: jest.fn().mockImplementation((entry) => {
        auditLog.push(entry);
        return Promise.resolve();
      }),
    };
    service = new CryptoShreddingService(mockKeyStore);
  });

  describe('shredUserData()', () => {
    it('Property 21: destroys every key identified for the user', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(fc.uuid()), async (keyIds) => {
          mockKeyStore.getKeyIdsForUser.mockResolvedValueOnce(keyIds);
          mockKeyStore.destroyKey.mockResolvedValue(undefined);

          const result = await service.shredUserData('user-1');

          expect(result.success).toBe(true);
          expect(result.keysDestroyed).toBe(keyIds.length);
          for (const keyId of keyIds) {
            expect(mockKeyStore.destroyKey).toHaveBeenCalledWith(keyId);
          }
          mockKeyStore.destroyKey.mockClear();
        }),
      );
    });

    it('should destroy all keys for a user and return success', async () => {
      const userId = 'user-123-abc';
      mockKeyStore.getKeyIdsForUser.mockResolvedValue([
        'key-1',
        'key-2',
        'key-3',
      ]);
      mockKeyStore.destroyKey.mockResolvedValue(undefined);

      const result = await service.shredUserData(userId);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.keysDestroyed).toBe(3);
      expect(result.shreddedAt).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('should call destroyKey for each user key', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue(['key-a', 'key-b']);
      mockKeyStore.destroyKey.mockResolvedValue(undefined);

      await service.shredUserData('user-456');

      expect(mockKeyStore.destroyKey).toHaveBeenCalledTimes(2);
      expect(mockKeyStore.destroyKey).toHaveBeenCalledWith('key-a');
      expect(mockKeyStore.destroyKey).toHaveBeenCalledWith('key-b');
    });

    it('should record audit entries for each key destruction', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue(['key-x']);
      mockKeyStore.destroyKey.mockResolvedValue(undefined);

      await service.shredUserData('user-789');

      // Should have: key_zeroed, key_destroyed, shredding_complete
      expect(mockKeyStore.recordAudit).toHaveBeenCalledTimes(3);

      const actions = auditLog.map((e) => e.action);
      expect(actions).toContain('key_zeroed');
      expect(actions).toContain('key_destroyed');
      expect(actions).toContain('shredding_complete');
    });

    it('should handle user with no keys gracefully', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue([]);

      const result = await service.shredUserData('user-no-keys');

      expect(result.success).toBe(true);
      expect(result.keysDestroyed).toBe(0);
      expect(mockKeyStore.destroyKey).not.toHaveBeenCalled();
    });

    it('should return failure when key destruction throws', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue(['key-fail']);
      mockKeyStore.destroyKey.mockRejectedValue(
        new Error('Storage unavailable'),
      );

      const result = await service.shredUserData('user-error');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Storage unavailable');
      expect(result.keysDestroyed).toBe(0);
    });

    it('should return failure when getKeyIdsForUser throws', async () => {
      mockKeyStore.getKeyIdsForUser.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await service.shredUserData('user-db-error');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection lost');
    });

    it('should include completion metadata with duration', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue(['key-1']);
      mockKeyStore.destroyKey.mockResolvedValue(undefined);

      await service.shredUserData('user-meta');

      const completionEntry = auditLog.find(
        (e) => e.action === 'shredding_complete',
      );
      expect(completionEntry).toBeDefined();
      expect(completionEntry!.metadata).toHaveProperty('keysDestroyed', 1);
      expect(completionEntry!.metadata).toHaveProperty('durationMs');
    });
  });

  describe('verifyShreddingComplete()', () => {
    it('should return true when no keys remain', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue([]);

      const result = await service.verifyShreddingComplete('user-done');

      expect(result).toBe(true);
    });

    it('should return false when keys still exist', async () => {
      mockKeyStore.getKeyIdsForUser.mockResolvedValue(['leftover-key']);

      const result = await service.verifyShreddingComplete('user-partial');

      expect(result).toBe(false);
    });
  });
});
