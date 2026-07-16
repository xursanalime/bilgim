/**
 * `modules/security/gdpr/gdpr.service.ts` — Task 30.4
 *
 * Main GDPR Data Subject Rights service.
 * Implements Requirement 32.2: data access, rectification, erasure,
 * and portability with 30-day SLA tracking.
 *
 * - Data access: collects PII from all modules and exports as JSON/CSV.
 * - Data rectification: updates personal data fields.
 * - Data erasure: delegates to CryptoShreddingService for irreversible deletion.
 * - Data portability: exports in a standard machine-readable format.
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { CryptoShreddingService } from '../pii/crypto-shredding.service';
import {
  DataSubjectRequest,
  DataSubjectRequestType,
  RequestStatus,
  ExportFormat,
  GdprExportData,
  SlaStatus,
  GDPR_SLA_DAYS,
  CreateAccessRequestDto,
  CreateRectificationRequestDto,
  CreateErasureRequestDto,
  CreatePortabilityRequestDto,
  AccessRequestMetadata,
  RectificationRequestMetadata,
  ErasureRequestMetadata,
  PortabilityRequestMetadata,
} from './gdpr-request.types';

/**
 * Interface for the data store that persists GDPR requests.
 * Allows swapping between Prisma, in-memory, or other backends.
 */
export interface GdprRequestStore {
  save(request: DataSubjectRequest): Promise<DataSubjectRequest>;
  findById(id: string): Promise<DataSubjectRequest | null>;
  findByUserId(userId: string): Promise<DataSubjectRequest[]>;
  findPending(): Promise<DataSubjectRequest[]>;
  findOverdue(): Promise<DataSubjectRequest[]>;
}

/**
 * Interface for collecting user data from various modules.
 * Each module that stores PII should implement a collector.
 */
export interface UserDataCollector {
  /** Module name (e.g., 'user', 'enrollment', 'submission'). */
  moduleName: string;
  /** Collect all personal data for a user. */
  collectUserData(userId: string): Promise<Record<string, unknown>[]>;
  /** Update personal data fields for a user. */
  rectifyUserData(userId: string, corrections: Record<string, unknown>): Promise<string[]>;
}

/** DI token for the GDPR request store. */
export const GDPR_REQUEST_STORE = Symbol('GDPR_REQUEST_STORE');

/** DI token for user data collectors. */
export const USER_DATA_COLLECTORS = Symbol('USER_DATA_COLLECTORS');

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly requestStore: GdprRequestStore,
    private readonly cryptoShreddingService: CryptoShreddingService,
    private readonly dataCollectors: UserDataCollector[],
  ) {}

  // -------------------------------------------------------------------------
  // Request lifecycle
  // -------------------------------------------------------------------------

  /**
   * Submit a data access request (Art. 15).
   * Exports all personal data in the requested format.
   */
  async submitAccessRequest(
    userId: string,
    dto: CreateAccessRequestDto,
  ): Promise<DataSubjectRequest> {
    const format = dto.format ?? ExportFormat.JSON;
    const request = this.createRequest(userId, DataSubjectRequestType.ACCESS, {
      type: DataSubjectRequestType.ACCESS,
      format,
    });
    return this.requestStore.save(request);
  }

  /**
   * Submit a data rectification request (Art. 16).
   * Corrects inaccurate personal data.
   */
  async submitRectificationRequest(
    userId: string,
    dto: CreateRectificationRequestDto,
  ): Promise<DataSubjectRequest> {
    if (!dto.corrections || Object.keys(dto.corrections).length === 0) {
      throw new BadRequestException('At least one correction must be specified');
    }
    const request = this.createRequest(userId, DataSubjectRequestType.RECTIFICATION, {
      type: DataSubjectRequestType.RECTIFICATION,
      corrections: dto.corrections,
    });
    return this.requestStore.save(request);
  }

  /**
   * Submit a data erasure request (Art. 17).
   * Uses crypto-shredding to make data permanently unrecoverable.
   */
  async submitErasureRequest(
    userId: string,
    dto: CreateErasureRequestDto,
  ): Promise<DataSubjectRequest> {
    if (!dto.confirmIrreversible) {
      throw new BadRequestException(
        'You must confirm that data erasure is irreversible',
      );
    }
    const request = this.createRequest(userId, DataSubjectRequestType.ERASURE, {
      type: DataSubjectRequestType.ERASURE,
    });
    return this.requestStore.save(request);
  }

  /**
   * Submit a data portability request (Art. 20).
   * Exports data in a standard machine-readable format.
   */
  async submitPortabilityRequest(
    userId: string,
    dto: CreatePortabilityRequestDto,
  ): Promise<DataSubjectRequest> {
    const format = dto.format ?? ExportFormat.JSON;
    const request = this.createRequest(userId, DataSubjectRequestType.PORTABILITY, {
      type: DataSubjectRequestType.PORTABILITY,
      format,
    });
    return this.requestStore.save(request);
  }

  // -------------------------------------------------------------------------
  // Processing
  // -------------------------------------------------------------------------

  /**
   * Process a pending data subject request.
   * Called by a scheduled job or manually by an admin.
   */
  async processRequest(requestId: string): Promise<DataSubjectRequest> {
    const request = await this.requestStore.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Request ${requestId} not found`);
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(
        `Request ${requestId} is not in PENDING status (current: ${request.status})`,
      );
    }

    // Transition to IN_PROGRESS.
    request.status = RequestStatus.IN_PROGRESS;
    request.updatedAt = new Date();
    await this.requestStore.save(request);

    try {
      switch (request.type) {
        case DataSubjectRequestType.ACCESS:
          await this.processAccessRequest(request);
          break;
        case DataSubjectRequestType.RECTIFICATION:
          await this.processRectificationRequest(request);
          break;
        case DataSubjectRequestType.ERASURE:
          await this.processErasureRequest(request);
          break;
        case DataSubjectRequestType.PORTABILITY:
          await this.processPortabilityRequest(request);
          break;
      }

      request.status = RequestStatus.COMPLETED;
      request.completedAt = new Date();
      request.updatedAt = new Date();
      this.logger.log(
        `GDPR request ${requestId} (${request.type}) completed for user ${request.userId.slice(0, 8)}***`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      request.status = RequestStatus.REJECTED;
      request.rejectionReason = `Processing failed: ${message}`;
      request.updatedAt = new Date();
      this.logger.error(
        `GDPR request ${requestId} failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return this.requestStore.save(request);
  }

  /**
   * Reject a request with a reason (e.g., identity not verified).
   */
  async rejectRequest(requestId: string, reason: string): Promise<DataSubjectRequest> {
    const request = await this.requestStore.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Request ${requestId} not found`);
    }
    request.status = RequestStatus.REJECTED;
    request.rejectionReason = reason;
    request.updatedAt = new Date();
    return this.requestStore.save(request);
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Get a specific request by ID.
   */
  async getRequest(requestId: string): Promise<DataSubjectRequest> {
    const request = await this.requestStore.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Request ${requestId} not found`);
    }
    return request;
  }

  /**
   * Get all requests for a user.
   */
  async getUserRequests(userId: string): Promise<DataSubjectRequest[]> {
    return this.requestStore.findByUserId(userId);
  }

  /**
   * Check SLA status for a request.
   */
  getSlaStatus(request: DataSubjectRequest): SlaStatus {
    const now = new Date();
    const deadline = request.deadline;
    const diffMs = deadline.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return {
      requestId: request.id,
      daysRemaining: Math.max(daysRemaining, 0),
      breached: daysRemaining < 0,
      deadline,
    };
  }

  /**
   * Get all overdue requests (SLA breached).
   */
  async getOverdueRequests(): Promise<DataSubjectRequest[]> {
    return this.requestStore.findOverdue();
  }

  // -------------------------------------------------------------------------
  // Data export (shared between ACCESS and PORTABILITY)
  // -------------------------------------------------------------------------

  /**
   * Collect all personal data for a user from all registered modules.
   */
  async collectAllUserData(userId: string, format: ExportFormat): Promise<GdprExportData> {
    const profile: Record<string, unknown> = {};
    const enrollments: Record<string, unknown>[] = [];
    const submissions: Record<string, unknown>[] = [];
    const payments: Record<string, unknown>[] = [];
    const activityLogs: Record<string, unknown>[] = [];

    for (const collector of this.dataCollectors) {
      const data = await collector.collectUserData(userId);
      switch (collector.moduleName) {
        case 'user':
          Object.assign(profile, ...data);
          break;
        case 'enrollment':
          enrollments.push(...data);
          break;
        case 'submission':
          submissions.push(...data);
          break;
        case 'payment':
          payments.push(...data);
          break;
        case 'activity':
          activityLogs.push(...data);
          break;
        default:
          // Unknown module — store under profile as a fallback.
          profile[collector.moduleName] = data;
          break;
      }
    }

    return {
      profile,
      enrollments,
      submissions,
      payments,
      activityLogs,
      exportedAt: new Date(),
      format,
    };
  }

  /**
   * Convert export data to CSV format.
   */
  exportToCsv(data: GdprExportData): string {
    const sections: string[] = [];

    // Profile section
    sections.push('--- PROFILE ---');
    sections.push(this.objectToCsvRows(data.profile));

    // Enrollments section
    if (data.enrollments.length > 0) {
      sections.push('--- ENROLLMENTS ---');
      sections.push(this.arrayToCsv(data.enrollments));
    }

    // Submissions section
    if (data.submissions.length > 0) {
      sections.push('--- SUBMISSIONS ---');
      sections.push(this.arrayToCsv(data.submissions));
    }

    // Payments section
    if (data.payments.length > 0) {
      sections.push('--- PAYMENTS ---');
      sections.push(this.arrayToCsv(data.payments));
    }

    // Activity logs section
    if (data.activityLogs.length > 0) {
      sections.push('--- ACTIVITY LOGS ---');
      sections.push(this.arrayToCsv(data.activityLogs));
    }

    return sections.join('\n\n');
  }

  // -------------------------------------------------------------------------
  // Private processing methods
  // -------------------------------------------------------------------------

  private async processAccessRequest(request: DataSubjectRequest): Promise<void> {
    const metadata = request.metadata as AccessRequestMetadata;
    const exportData = await this.collectAllUserData(request.userId, metadata.format);

    let exportContent: string;
    if (metadata.format === ExportFormat.CSV) {
      exportContent = this.exportToCsv(exportData);
    } else {
      exportContent = JSON.stringify(exportData, null, 2);
    }

    metadata.exportSizeBytes = Buffer.byteLength(exportContent, 'utf-8');
    // In production, this would upload to secure storage and set downloadUrl.
    metadata.downloadUrl = `/gdpr/requests/${request.id}/download`;
  }

  private async processRectificationRequest(request: DataSubjectRequest): Promise<void> {
    const metadata = request.metadata as RectificationRequestMetadata;
    const allUpdatedFields: string[] = [];

    for (const collector of this.dataCollectors) {
      const updatedFields = await collector.rectifyUserData(
        request.userId,
        metadata.corrections,
      );
      allUpdatedFields.push(...updatedFields);
    }

    metadata.updatedFields = allUpdatedFields;
  }

  private async processErasureRequest(request: DataSubjectRequest): Promise<void> {
    const metadata = request.metadata as ErasureRequestMetadata;

    this.logger.warn(
      `Executing crypto-shredding for user ${request.userId.slice(0, 8)}*** (request ${request.id})`,
    );

    const result = await this.cryptoShreddingService.shredUserData(request.userId);

    if (!result.success) {
      throw new Error(`Crypto-shredding failed: ${result.error}`);
    }

    metadata.keysDestroyed = result.keysDestroyed;

    // Verify shredding is complete.
    const verified = await this.cryptoShreddingService.verifyShreddingComplete(request.userId);
    metadata.shreddingVerified = verified;

    if (!verified) {
      throw new Error('Crypto-shredding verification failed — keys may still exist');
    }
  }

  private async processPortabilityRequest(request: DataSubjectRequest): Promise<void> {
    const metadata = request.metadata as PortabilityRequestMetadata;
    const exportData = await this.collectAllUserData(request.userId, metadata.format);

    let exportContent: string;
    if (metadata.format === ExportFormat.CSV) {
      exportContent = this.exportToCsv(exportData);
    } else {
      exportContent = JSON.stringify(exportData, null, 2);
    }

    metadata.exportSizeBytes = Buffer.byteLength(exportContent, 'utf-8');
    metadata.downloadUrl = `/gdpr/requests/${request.id}/download`;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private createRequest(
    userId: string,
    type: DataSubjectRequestType,
    metadata: DataSubjectRequest['metadata'],
  ): DataSubjectRequest {
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + GDPR_SLA_DAYS);

    return {
      id: randomUUID(),
      userId,
      type,
      status: RequestStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      deadline,
      completedAt: null,
      rejectionReason: null,
      metadata,
    };
  }

  private objectToCsvRows(obj: Record<string, unknown>): string {
    const rows: string[] = ['key,value'];
    for (const [key, value] of Object.entries(obj)) {
      const escaped = String(value ?? '').replace(/"/g, '""');
      rows.push(`"${key}","${escaped}"`);
    }
    return rows.join('\n');
  }

  private arrayToCsv(arr: Record<string, unknown>[]): string {
    if (arr.length === 0) return '';
    const headers = [...new Set(arr.flatMap((item) => Object.keys(item)))];
    const rows: string[] = [headers.map((h) => `"${h}"`).join(',')];
    for (const item of arr) {
      const row = headers.map((h) => {
        const val = String(item[h] ?? '').replace(/"/g, '""');
        return `"${val}"`;
      });
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }
}
