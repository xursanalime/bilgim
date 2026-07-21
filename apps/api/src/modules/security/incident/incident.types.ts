/**
 * Incident Response Types — Task 30.6
 *
 * Defines the full incident lifecycle, severity levels, breach
 * notification tracking, and penetration testing SLA structures.
 *
 * Requirements: 32.6, 32.7, 32.9, 32.10
 */

// ─── Incident Severity ───────────────────────────────────────────

/** Severity levels aligned with penetration testing SLA deadlines. */
export enum IncidentSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/** SLA resolution deadlines per severity (in hours). */
export const SEVERITY_SLA_HOURS: Record<IncidentSeverity, number> = {
  [IncidentSeverity.CRITICAL]: 24,
  [IncidentSeverity.HIGH]: 7 * 24,
  [IncidentSeverity.MEDIUM]: 30 * 24,
  [IncidentSeverity.LOW]: 90 * 24,
};

// ─── Incident Status & Phase ─────────────────────────────────────

/** High-level incident status. */
export enum IncidentStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

/**
 * Incident lifecycle phases following the automated playbook:
 * DETECTED → TRIAGED → CONTAINED → ERADICATED → RECOVERED → POST_MORTEM → CLOSED
 */
export enum IncidentPhase {
  DETECTED = 'DETECTED',
  TRIAGED = 'TRIAGED',
  CONTAINED = 'CONTAINED',
  ERADICATED = 'ERADICATED',
  RECOVERED = 'RECOVERED',
  POST_MORTEM = 'POST_MORTEM',
  CLOSED = 'CLOSED',
}

/** Valid phase transitions. */
export const PHASE_TRANSITIONS: Record<IncidentPhase, IncidentPhase[]> = {
  [IncidentPhase.DETECTED]: [IncidentPhase.TRIAGED],
  [IncidentPhase.TRIAGED]: [IncidentPhase.CONTAINED],
  [IncidentPhase.CONTAINED]: [IncidentPhase.ERADICATED],
  [IncidentPhase.ERADICATED]: [IncidentPhase.RECOVERED],
  [IncidentPhase.RECOVERED]: [IncidentPhase.POST_MORTEM],
  [IncidentPhase.POST_MORTEM]: [IncidentPhase.CLOSED],
  [IncidentPhase.CLOSED]: [],
};

// ─── Containment Actions ─────────────────────────────────────────

export enum ContainmentActionType {
  IP_BLOCK = 'IP_BLOCK',
  SESSION_REVOKE = 'SESSION_REVOKE',
  ACCOUNT_LOCKOUT = 'ACCOUNT_LOCKOUT',
}

export interface ContainmentAction {
  type: ContainmentActionType;
  target: string; // IP address, session ID, or user ID
  executedAt: number; // epoch ms
  success: boolean;
  details?: string;
}

// ─── Incident Record ─────────────────────────────────────────────

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  phase: IncidentPhase;
  /** Source that triggered the incident (anomaly detection, manual, etc.) */
  source: string;
  /** Affected IP addresses. */
  affectedIps: string[];
  /** Affected user IDs. */
  affectedUserIds: string[];
  /** Containment actions taken. */
  containmentActions: ContainmentAction[];
  /** Phase transition timestamps (epoch ms). */
  phaseHistory: PhaseTransition[];
  /** When the incident was first detected (epoch ms). */
  detectedAt: number;
  /** When the alert was sent (epoch ms). */
  alertedAt: number | null;
  /** When the incident was resolved (epoch ms). */
  resolvedAt: number | null;
  /** SLA deadline (epoch ms). */
  slaDeadline: number;
  /** Whether SLA was breached. */
  slaBreached: boolean;
  /** Post-mortem notes. */
  postMortem: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PhaseTransition {
  from: IncidentPhase;
  to: IncidentPhase;
  timestamp: number;
  actor: string; // 'system' or user ID
}

// ─── Alert Provider Port ─────────────────────────────────────────

/** Injection token for the alert provider (PagerDuty/Opsgenie). */
export const ALERT_PROVIDER = Symbol('ALERT_PROVIDER');

/** Alert urgency levels mapped from incident severity. */
export enum AlertUrgency {
  CRITICAL = 'critical',
  HIGH = 'high',
  LOW = 'low',
}

export interface AlertPayload {
  incidentId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  urgency: AlertUrgency;
  source: string;
  affectedIps: string[];
  affectedUserIds: string[];
  timestamp: number;
}

/**
 * Port interface for external alerting services (PagerDuty, Opsgenie).
 * Implementations send webhook calls to the configured provider.
 */
export interface AlertProvider {
  /** Send an alert. Must resolve within 5 seconds. */
  sendAlert(payload: AlertPayload): Promise<{ success: boolean; alertId?: string }>;
  /** Acknowledge an existing alert. */
  acknowledgeAlert(alertId: string): Promise<boolean>;
  /** Resolve/close an existing alert. */
  resolveAlert(alertId: string): Promise<boolean>;
}

// ─── Breach Notification ─────────────────────────────────────────

/** GDPR 72-hour breach notification deadline. */
export const BREACH_NOTIFICATION_DEADLINE_HOURS = 72;

export enum BreachNotificationStatus {
  PENDING = 'PENDING',
  AUTHORITY_NOTIFIED = 'AUTHORITY_NOTIFIED',
  USERS_NOTIFIED = 'USERS_NOTIFIED',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
}

export interface BreachNotification {
  id: string;
  incidentId: string;
  /** Nature of the breach. */
  breachType: string;
  /** Categories of personal data affected. */
  dataCategories: string[];
  /** Approximate number of affected users. */
  affectedUserCount: number;
  /** Affected user IDs (for targeted notification). */
  affectedUserIds: string[];
  /** Likely consequences of the breach. */
  consequences: string;
  /** Measures taken or proposed to address the breach. */
  mitigationMeasures: string;
  /** Current notification status. */
  status: BreachNotificationStatus;
  /** 72-hour deadline (epoch ms). */
  deadline: number;
  /** When authority was notified (epoch ms). */
  authorityNotifiedAt: number | null;
  /** When users were notified (epoch ms). */
  usersNotifiedAt: number | null;
  /** Whether the 72-hour deadline was met. */
  deadlineMet: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface BreachNotificationCreateInput {
  incidentId: string;
  breachType: string;
  dataCategories: string[];
  affectedUserCount: number;
  affectedUserIds: string[];
  consequences: string;
  mitigationMeasures: string;
}

// ─── Penetration Testing ─────────────────────────────────────────

export enum PentestStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FINDINGS_OPEN = 'FINDINGS_OPEN',
  FINDINGS_RESOLVED = 'FINDINGS_RESOLVED',
}

export interface PentestFinding {
  id: string;
  pentestId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  /** SLA deadline for resolution (epoch ms). */
  slaDeadline: number;
  /** Whether the finding has been resolved. */
  resolved: boolean;
  resolvedAt: number | null;
  /** Whether SLA was breached. */
  slaBreached: boolean;
  createdAt: number;
}

export interface PentestRecord {
  id: string;
  /** Quarterly identifier (e.g., "2024-Q1"). */
  quarter: string;
  /** Testing firm / provider. */
  provider: string;
  /** Start date (epoch ms). */
  startedAt: number;
  /** End date (epoch ms). */
  completedAt: number | null;
  status: PentestStatus;
  findings: PentestFinding[];
  /** Overall risk score (0-100). */
  riskScore: number | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Third-Party Security Audit ──────────────────────────────────

export enum AuditStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  REMEDIATION_IN_PROGRESS = 'REMEDIATION_IN_PROGRESS',
  REMEDIATION_COMPLETE = 'REMEDIATION_COMPLETE',
}

export interface SecurityAuditRecord {
  id: string;
  /** Audit period (e.g., "2024-H1" for first half). */
  period: string;
  /** Auditing firm. */
  auditor: string;
  /** Audit type (SOC2, ISO27001, custom, etc.). */
  auditType: string;
  status: AuditStatus;
  startedAt: number;
  completedAt: number | null;
  /** Number of findings by severity. */
  findingsSummary: Record<IncidentSeverity, number>;
  /** Remediation progress (0-100%). */
  remediationProgress: number;
  /** Next audit due date (epoch ms). */
  nextAuditDue: number | null;
  createdAt: number;
  updatedAt: number;
}
