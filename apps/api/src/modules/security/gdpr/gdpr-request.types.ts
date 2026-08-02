/**
 * `modules/security/gdpr/gdpr-request.types.ts` — Task 30.4
 *
 * Types for GDPR Data Subject Requests (DSR).
 * Implements Requirement 32.2: GDPR-style data subject rights
 * (access, rectification, erasure, portability) with 30-day SLA.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * The type of data subject request.
 */
export enum DataSubjectRequestType {
  /** Right of access — export all personal data (Art. 15). */
  ACCESS = 'ACCESS',
  /** Right to rectification — correct inaccurate personal data (Art. 16). */
  RECTIFICATION = 'RECTIFICATION',
  /** Right to erasure — "right to be forgotten" via crypto-shredding (Art. 17). */
  ERASURE = 'ERASURE',
  /** Right to data portability — export in machine-readable format (Art. 20). */
  PORTABILITY = 'PORTABILITY',
}

/**
 * Status of a data subject request through its lifecycle.
 */
export enum RequestStatus {
  /** Request received, awaiting processing. */
  PENDING = 'PENDING',
  /** Request is actively being processed. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Request has been fulfilled. */
  COMPLETED = 'COMPLETED',
  /** Request was rejected (e.g., identity not verified, legal exception). */
  REJECTED = 'REJECTED',
}

/**
 * Export format for data access and portability requests.
 */
export enum ExportFormat {
  JSON = 'JSON',
  CSV = 'CSV',
}

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

/**
 * Represents a single GDPR data subject request.
 * Tracks the full lifecycle from submission to completion.
 */
export interface DataSubjectRequest {
  /** Unique identifier for this request. */
  id: string;
  /** The user who submitted the request (data subject). */
  userId: string;
  /** Type of request (access, rectification, erasure, portability). */
  type: DataSubjectRequestType;
  /** Current processing status. */
  status: RequestStatus;
  /** When the request was created. */
  createdAt: Date;
  /** When the request was last updated. */
  updatedAt: Date;
  /** SLA deadline — 30 calendar days from creation. */
  deadline: Date;
  /** When the request was completed (null if not yet completed). */
  completedAt: Date | null;
  /** Reason for rejection (null if not rejected). */
  rejectionReason: string | null;
  /** Additional metadata for the request. */
  metadata: DataSubjectRequestMetadata;
}

// ---------------------------------------------------------------------------
// Metadata types per request type
// ---------------------------------------------------------------------------

export type DataSubjectRequestMetadata =
  | AccessRequestMetadata
  | RectificationRequestMetadata
  | ErasureRequestMetadata
  | PortabilityRequestMetadata;

export interface AccessRequestMetadata {
  type: DataSubjectRequestType.ACCESS;
  format: ExportFormat;
  /** URL to download the exported data (set after completion). */
  downloadUrl?: string;
  /** Size of the exported data in bytes. */
  exportSizeBytes?: number;
}

export interface RectificationRequestMetadata {
  type: DataSubjectRequestType.RECTIFICATION;
  /** Fields to be corrected with their new values. */
  corrections: Record<string, unknown>;
  /** Which fields were actually updated. */
  updatedFields?: string[];
}

export interface ErasureRequestMetadata {
  type: DataSubjectRequestType.ERASURE;
  /** Number of encryption keys destroyed via crypto-shredding. */
  keysDestroyed?: number;
  /** Whether crypto-shredding was verified complete. */
  shreddingVerified?: boolean;
}

export interface PortabilityRequestMetadata {
  type: DataSubjectRequestType.PORTABILITY;
  format: ExportFormat;
  /** URL to download the portable data package. */
  downloadUrl?: string;
  /** Size of the exported data in bytes. */
  exportSizeBytes?: number;
}

// ---------------------------------------------------------------------------
// DTOs for controller layer
// ---------------------------------------------------------------------------

export interface CreateAccessRequestDto {
  format?: ExportFormat;
}

export interface CreateRectificationRequestDto {
  corrections: Record<string, unknown>;
}

export interface CreateErasureRequestDto {
  /** User must confirm they understand erasure is irreversible. */
  confirmIrreversible: boolean;
}

export interface CreatePortabilityRequestDto {
  format?: ExportFormat;
}

// ---------------------------------------------------------------------------
// Service result types
// ---------------------------------------------------------------------------

export interface GdprExportData {
  /** User profile information. */
  profile: Record<string, unknown>;
  /** Enrollment records. */
  enrollments: Record<string, unknown>[];
  /** Submission records. */
  submissions: Record<string, unknown>[];
  /** Payment/billing records. */
  payments: Record<string, unknown>[];
  /** Activity/audit logs related to the user. */
  activityLogs: Record<string, unknown>[];
  /** Export metadata. */
  exportedAt: Date;
  /** Format of the export. */
  format: ExportFormat;
}

export interface SlaStatus {
  /** The request ID. */
  requestId: string;
  /** Days remaining until SLA deadline. */
  daysRemaining: number;
  /** Whether the SLA has been breached. */
  breached: boolean;
  /** The deadline date. */
  deadline: Date;
}

/** SLA period in days (GDPR mandates 30 days). */
export const GDPR_SLA_DAYS = 30;
