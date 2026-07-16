import { BadRequestException, NotFoundException } from '@nestjs/common';
import fc from 'fast-check';

import { CryptoShreddingService } from '../pii/crypto-shredding.service';
import {
  GdprService,
  GdprRequestStore,
  UserDataCollector,
} from './gdpr.service';
import {
  DataSubjectRequest,
  DataSubjectRequestType,
  RequestStatus,
  ExportFormat,
  GDPR_SLA_DAYS,
} from './gdpr-request.types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class InMemoryRequestStore implements GdprRequestStore {
  private requests = new Map<string, DataSubjectRequest>();

  async save(request: DataSubjectRequest): Promise<DataSubjectRequest> {
    this.requests.set(request.id, { ...request });
    return { ...request };
  }

  async findById(id: string): Promise<DataSubjectRequest | null> {
    return this.requests.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<DataSubjectRequest[]> {
    return [...this.requests.values()].filter((r) => r.userId === userId);
  }

  async findPending(): Promise<DataSubjectRequest[]> {
    return [...this.requests.values()].filter(
      (r) => r.status === RequestStatus.PENDING,
    );
  }

  async findOverdue(): Promise<DataSubjectRequest[]> {
    const now = new Date();
    return [...this.requests.values()].filter(
      (r) =>
        r.status !== RequestStatus.COMPLETED &&
        r.status !== RequestStatus.REJECTED &&
        r.deadline < now,
    );
  }
}

function createMockCryptoShreddingService(): jest.Mocked<CryptoShreddingService> {
  return {
    shredUserData: jest.fn().mockResolvedValue({
      userId: 'user-1',
      keysDestroyed: 3,
      shreddedAt: new Date(),
      success: true,
    }),
    verifyShreddingComplete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<CryptoShreddingService>;
}

function createMockDataCollectors(): UserDataCollector[] {
  return [
    {
      moduleName: 'user',
      collectUserData: jest.fn().mockResolvedValue([
        { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      ]),
      rectifyUserData: jest.fn().mockResolvedValue(['email', 'name']),
    },
    {
      moduleName: 'enrollment',
      collectUserData: jest.fn().mockResolvedValue([
        { id: 'enr-1', courseId: 'course-1', enrolledAt: '2024-01-01' },
      ]),
      rectifyUserData: jest.fn().mockResolvedValue([]),
    },
    {
      moduleName: 'submission',
      collectUserData: jest.fn().mockResolvedValue([
        { id: 'sub-1', assignmentId: 'hw-1', grade: 95 },
      ]),
      rectifyUserData: jest.fn().mockResolvedValue([]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GdprService', () => {
  let service: GdprService;
  let store: InMemoryRequestStore;
  let cryptoShredding: jest.Mocked<CryptoShreddingService>;
  let collectors: UserDataCollector[];

  beforeEach(() => {
    store = new InMemoryRequestStore();
    cryptoShredding = createMockCryptoShreddingService();
    collectors = createMockDataCollectors();
    service = new GdprService(store, cryptoShredding, collectors);
  });

  // -------------------------------------------------------------------------
  // Submit requests
  // -------------------------------------------------------------------------

  describe('submitAccessRequest', () => {
    it('should create a PENDING access request with JSON format by default', async () => {
      const request = await service.submitAccessRequest('user-1', {});

      expect(request.userId).toBe('user-1');
      expect(request.type).toBe(DataSubjectRequestType.ACCESS);
      expect(request.status).toBe(RequestStatus.PENDING);
      expect(request.metadata).toEqual({
        type: DataSubjectRequestType.ACCESS,
        format: ExportFormat.JSON,
      });
    });

    it('should create an access request with CSV format when specified', async () => {
      const request = await service.submitAccessRequest('user-1', {
        format: ExportFormat.CSV,
      });

      expect(request.metadata).toEqual({
        type: DataSubjectRequestType.ACCESS,
        format: ExportFormat.CSV,
      });
    });

    it('should set a 30-day SLA deadline', async () => {
      const before = new Date();
      const request = await service.submitAccessRequest('user-1', {});
      const after = new Date();

      const expectedDeadlineMin = new Date(before);
      expectedDeadlineMin.setDate(expectedDeadlineMin.getDate() + GDPR_SLA_DAYS);
      const expectedDeadlineMax = new Date(after);
      expectedDeadlineMax.setDate(expectedDeadlineMax.getDate() + GDPR_SLA_DAYS);

      expect(request.deadline.getTime()).toBeGreaterThanOrEqual(
        expectedDeadlineMin.getTime(),
      );
      expect(request.deadline.getTime()).toBeLessThanOrEqual(
        expectedDeadlineMax.getTime(),
      );
    });
  });

  describe('submitRectificationRequest', () => {
    it('should create a PENDING rectification request', async () => {
      const request = await service.submitRectificationRequest('user-1', {
        corrections: { email: 'new@example.com' },
      });

      expect(request.type).toBe(DataSubjectRequestType.RECTIFICATION);
      expect(request.status).toBe(RequestStatus.PENDING);
      expect(request.metadata).toEqual({
        type: DataSubjectRequestType.RECTIFICATION,
        corrections: { email: 'new@example.com' },
      });
    });

    it('should reject empty corrections', async () => {
      await expect(
        service.submitRectificationRequest('user-1', { corrections: {} }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitErasureRequest', () => {
    it('should create a PENDING erasure request when confirmed', async () => {
      const request = await service.submitErasureRequest('user-1', {
        confirmIrreversible: true,
      });

      expect(request.type).toBe(DataSubjectRequestType.ERASURE);
      expect(request.status).toBe(RequestStatus.PENDING);
    });

    it('should reject if not confirmed irreversible', async () => {
      await expect(
        service.submitErasureRequest('user-1', { confirmIrreversible: false }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitPortabilityRequest', () => {
    it('should create a PENDING portability request', async () => {
      const request = await service.submitPortabilityRequest('user-1', {});

      expect(request.type).toBe(DataSubjectRequestType.PORTABILITY);
      expect(request.status).toBe(RequestStatus.PENDING);
      expect(request.metadata).toEqual({
        type: DataSubjectRequestType.PORTABILITY,
        format: ExportFormat.JSON,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Process requests
  // -------------------------------------------------------------------------

  describe('processRequest', () => {
    it('should process an access request and collect user data', async () => {
      const submitted = await service.submitAccessRequest('user-1', {});
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.COMPLETED);
      expect(processed.completedAt).toBeInstanceOf(Date);
    });

    it('should process a rectification request and update fields', async () => {
      const submitted = await service.submitRectificationRequest('user-1', {
        corrections: { email: 'new@example.com' },
      });
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.COMPLETED);
    });

    it('should process an erasure request using crypto-shredding', async () => {
      const submitted = await service.submitErasureRequest('user-1', {
        confirmIrreversible: true,
      });
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.COMPLETED);
      expect(cryptoShredding.shredUserData).toHaveBeenCalledWith('user-1');
      expect(cryptoShredding.verifyShreddingComplete).toHaveBeenCalledWith('user-1');
    });

    it('should fail erasure if crypto-shredding fails', async () => {
      cryptoShredding.shredUserData.mockResolvedValueOnce({
        userId: 'user-1',
        keysDestroyed: 0,
        shreddedAt: new Date(),
        success: false,
        error: 'Key store unavailable',
      });

      const submitted = await service.submitErasureRequest('user-1', {
        confirmIrreversible: true,
      });
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.REJECTED);
      expect(processed.rejectionReason).toContain('Crypto-shredding failed');
    });

    it('should fail erasure if verification fails', async () => {
      cryptoShredding.verifyShreddingComplete.mockResolvedValueOnce(false);

      const submitted = await service.submitErasureRequest('user-1', {
        confirmIrreversible: true,
      });
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.REJECTED);
      expect(processed.rejectionReason).toContain('verification failed');
    });

    it('should process a portability request', async () => {
      const submitted = await service.submitPortabilityRequest('user-1', {
        format: ExportFormat.CSV,
      });
      const processed = await service.processRequest(submitted.id);

      expect(processed.status).toBe(RequestStatus.COMPLETED);
    });

    it('should throw NotFoundException for unknown request ID', async () => {
      await expect(service.processRequest('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if request is not PENDING', async () => {
      const submitted = await service.submitAccessRequest('user-1', {});
      await service.processRequest(submitted.id);

      await expect(service.processRequest(submitted.id)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Reject requests
  // -------------------------------------------------------------------------

  describe('rejectRequest', () => {
    it('should reject a request with a reason', async () => {
      const submitted = await service.submitAccessRequest('user-1', {});
      const rejected = await service.rejectRequest(
        submitted.id,
        'Identity not verified',
      );

      expect(rejected.status).toBe(RequestStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('Identity not verified');
    });

    it('should throw NotFoundException for unknown request', async () => {
      await expect(
        service.rejectRequest('nonexistent', 'reason'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  describe('getRequest', () => {
    it('should return a request by ID', async () => {
      const submitted = await service.submitAccessRequest('user-1', {});
      const found = await service.getRequest(submitted.id);

      expect(found.id).toBe(submitted.id);
    });

    it('should throw NotFoundException for unknown ID', async () => {
      await expect(service.getRequest('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserRequests', () => {
    it('should return all requests for a user', async () => {
      await service.submitAccessRequest('user-1', {});
      await service.submitPortabilityRequest('user-1', {});
      await service.submitAccessRequest('user-2', {});

      const user1Requests = await service.getUserRequests('user-1');
      expect(user1Requests).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // SLA tracking
  // -------------------------------------------------------------------------

  describe('getSlaStatus', () => {
    it('should return days remaining within SLA', async () => {
      const request = await service.submitAccessRequest('user-1', {});
      const sla = service.getSlaStatus(request);

      expect(sla.daysRemaining).toBe(GDPR_SLA_DAYS);
      expect(sla.breached).toBe(false);
      expect(sla.requestId).toBe(request.id);
    });

    it('should detect SLA breach for overdue requests', () => {
      const pastDeadline = new Date();
      pastDeadline.setDate(pastDeadline.getDate() - 5);

      const overdueRequest: DataSubjectRequest = {
        id: 'overdue-1',
        userId: 'user-1',
        type: DataSubjectRequestType.ACCESS,
        status: RequestStatus.PENDING,
        createdAt: new Date(pastDeadline.getTime() - 35 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(pastDeadline.getTime() - 35 * 24 * 60 * 60 * 1000),
        deadline: pastDeadline,
        completedAt: null,
        rejectionReason: null,
        metadata: { type: DataSubjectRequestType.ACCESS, format: ExportFormat.JSON },
      };

      const sla = service.getSlaStatus(overdueRequest);
      expect(sla.breached).toBe(true);
      expect(sla.daysRemaining).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Data export
  // -------------------------------------------------------------------------

  describe('collectAllUserData', () => {
    it('Property 30: exports completeness - includes data from all registered collectors', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (userId) => {
          const data = await service.collectAllUserData(userId, ExportFormat.JSON);
          
          // Must include the base envelope details
          expect(data).toHaveProperty('exportedAt');
          expect(data).toHaveProperty('format', ExportFormat.JSON);
          
          // Must include keys mapped from the mocked collectors
          expect(data).toHaveProperty('profile');
          expect(data).toHaveProperty('enrollments');
          expect(data).toHaveProperty('submissions');
        })
      );
    });

    it('should collect data from all registered collectors', async () => {
      const data = await service.collectAllUserData('user-1', ExportFormat.JSON);

      expect(data.profile).toHaveProperty('email', 'test@example.com');
      expect(data.enrollments).toHaveLength(1);
      expect(data.submissions).toHaveLength(1);
      expect(data.exportedAt).toBeInstanceOf(Date);
      expect(data.format).toBe(ExportFormat.JSON);
    });
  });

  describe('exportToCsv', () => {
    it('should convert export data to CSV format', async () => {
      const data = await service.collectAllUserData('user-1', ExportFormat.CSV);
      const csv = service.exportToCsv(data);

      expect(csv).toContain('--- PROFILE ---');
      expect(csv).toContain('--- ENROLLMENTS ---');
      expect(csv).toContain('--- SUBMISSIONS ---');
      expect(csv).toContain('test@example.com');
    });
  });
});
