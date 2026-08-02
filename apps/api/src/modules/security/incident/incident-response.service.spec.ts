import { IncidentResponseService, CreateIncidentInput } from './incident-response.service';
import { BreachNotificationService } from './breach-notification.service';
import { PentestTrackerService } from './pentest-tracker.service';
import {
  IncidentSeverity,
  IncidentStatus,
  IncidentPhase,
  ContainmentActionType,
  BreachNotificationStatus,
  PentestStatus,
  AuditStatus,
  SEVERITY_SLA_HOURS,
  BREACH_NOTIFICATION_DEADLINE_HOURS,
  AlertProvider,
} from './incident.types';

// ─── Mocks ───────────────────────────────────────────────────────

const mockIpBlocklistService = {
  block: jest.fn().mockResolvedValue(true),
  unblock: jest.fn().mockResolvedValue(true),
  isBlocked: jest.fn().mockResolvedValue(false),
};

const mockAlertProvider: AlertProvider = {
  sendAlert: jest.fn().mockResolvedValue({ success: true, alertId: 'alert-123' }),
  acknowledgeAlert: jest.fn().mockResolvedValue(true),
  resolveAlert: jest.fn().mockResolvedValue(true),
};

// ─── IncidentResponseService Tests ───────────────────────────────

describe('IncidentResponseService', () => {
  let service: IncidentResponseService;

  const defaultInput: CreateIncidentInput = {
    title: 'SQL Injection Attempt Detected',
    description: 'Multiple SQL injection payloads from IP 192.168.1.100',
    severity: IncidentSeverity.HIGH,
    source: 'anomaly_detection',
    affectedIps: ['192.168.1.100'],
    affectedUserIds: ['user-1', 'user-2'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IncidentResponseService(
      mockIpBlocklistService as any,
      mockAlertProvider,
      new BreachNotificationService(),
    );
  });

  describe('createIncident', () => {
    it('should create an incident in DETECTED phase', async () => {
      const incident = await service.createIncident(defaultInput);

      expect(incident.id).toBeDefined();
      expect(incident.title).toBe(defaultInput.title);
      expect(incident.severity).toBe(IncidentSeverity.HIGH);
      expect(incident.phase).toBe(IncidentPhase.DETECTED);
      expect(incident.status).toBe(IncidentStatus.OPEN);
      expect(incident.affectedIps).toEqual(['192.168.1.100']);
      expect(incident.affectedUserIds).toEqual(['user-1', 'user-2']);
      expect(incident.detectedAt).toBeGreaterThan(0);
      expect(incident.alertedAt).toBeGreaterThan(0);
    });

    it('should calculate SLA deadline based on severity', async () => {
      const incident = await service.createIncident(defaultInput);
      const expectedDeadline =
        incident.detectedAt + SEVERITY_SLA_HOURS[IncidentSeverity.HIGH] * 60 * 60 * 1000;

      expect(incident.slaDeadline).toBe(expectedDeadline);
    });

    it('should send alert via configured provider', async () => {
      await service.createIncident(defaultInput);

      expect(mockAlertProvider.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: defaultInput.title,
          severity: IncidentSeverity.HIGH,
          source: 'anomaly_detection',
        }),
      );
    });

    it('should handle missing alert provider gracefully', async () => {
      const serviceNoAlert = new IncidentResponseService(
        mockIpBlocklistService as any,
        undefined,
        undefined,
      );

      const incident = await serviceNoAlert.createIncident(defaultInput);
      expect(incident.alertedAt).toBeGreaterThan(0);
    });

    it('should handle alert provider failure gracefully', async () => {
      const failingProvider: AlertProvider = {
        sendAlert: jest.fn().mockRejectedValue(new Error('Network timeout')),
        acknowledgeAlert: jest.fn(),
        resolveAlert: jest.fn(),
      };

      const serviceFailAlert = new IncidentResponseService(
        mockIpBlocklistService as any,
        failingProvider,
        undefined,
      );

      const incident = await serviceFailAlert.createIncident(defaultInput);
      // Fail-open: alertedAt is still set
      expect(incident.alertedAt).toBeGreaterThan(0);
    });
  });

  describe('phase transitions', () => {
    it('should advance through the full lifecycle', async () => {
      const incident = await service.createIncident(defaultInput);

      // DETECTED → TRIAGED
      const triaged = service.triage(incident.id);
      expect(triaged?.phase).toBe(IncidentPhase.TRIAGED);
      expect(triaged?.status).toBe(IncidentStatus.IN_PROGRESS);

      // TRIAGED → CONTAINED
      const contained = await service.contain(incident.id);
      expect(contained?.phase).toBe(IncidentPhase.CONTAINED);

      // CONTAINED → ERADICATED
      const eradicated = service.eradicate(incident.id);
      expect(eradicated?.phase).toBe(IncidentPhase.ERADICATED);

      // ERADICATED → RECOVERED
      const recovered = service.recover(incident.id);
      expect(recovered?.phase).toBe(IncidentPhase.RECOVERED);
      expect(recovered?.status).toBe(IncidentStatus.RESOLVED);

      // RECOVERED → POST_MORTEM
      const postMortem = service.recordPostMortem(
        incident.id,
        'Root cause: unpatched dependency',
      );
      expect(postMortem?.phase).toBe(IncidentPhase.POST_MORTEM);
      expect(postMortem?.postMortem).toBe('Root cause: unpatched dependency');

      // POST_MORTEM → CLOSED
      const closed = service.close(incident.id);
      expect(closed?.phase).toBe(IncidentPhase.CLOSED);
      expect(closed?.status).toBe(IncidentStatus.CLOSED);
      expect(closed?.resolvedAt).toBeGreaterThan(0);
    });

    it('should reject invalid phase transitions', async () => {
      const incident = await service.createIncident(defaultInput);

      // Cannot skip from DETECTED to CONTAINED
      const result = service.advancePhase(incident.id, IncidentPhase.CONTAINED);
      expect(result).toBeNull();
      expect(service.getIncident(incident.id)?.phase).toBe(IncidentPhase.DETECTED);
    });

    it('should record phase history', async () => {
      const incident = await service.createIncident(defaultInput);
      service.triage(incident.id, 'admin-1');

      const updated = service.getIncident(incident.id)!;
      expect(updated.phaseHistory).toHaveLength(1);
      expect(updated.phaseHistory[0]).toEqual(
        expect.objectContaining({
          from: IncidentPhase.DETECTED,
          to: IncidentPhase.TRIAGED,
          actor: 'admin-1',
        }),
      );
    });

    it('should return null for non-existent incident', () => {
      expect(service.triage('non-existent')).toBeNull();
    });
  });

  describe('containment', () => {
    it('should block affected IPs', async () => {
      const incident = await service.createIncident(defaultInput);
      service.triage(incident.id);
      await service.contain(incident.id);

      expect(mockIpBlocklistService.block).toHaveBeenCalledWith(
        '192.168.1.100',
        IncidentResponseService.CONTAINMENT_BLOCK_TTL_SEC,
        expect.stringContaining(incident.id),
        'incident_response',
      );

      const updated = service.getIncident(incident.id)!;
      const ipBlockAction = updated.containmentActions.find(
        (a) => a.type === ContainmentActionType.IP_BLOCK,
      );
      expect(ipBlockAction).toBeDefined();
      expect(ipBlockAction?.success).toBe(true);
    });

    it('should revoke sessions for affected users', async () => {
      const incident = await service.createIncident(defaultInput);
      service.triage(incident.id);
      await service.contain(incident.id);

      const updated = service.getIncident(incident.id)!;
      const sessionActions = updated.containmentActions.filter(
        (a) => a.type === ContainmentActionType.SESSION_REVOKE,
      );
      expect(sessionActions).toHaveLength(2);
      expect(sessionActions[0]!.target).toBe('user-1');
      expect(sessionActions[1]!.target).toBe('user-2');
    });

    it('should handle IP block failure gracefully', async () => {
      mockIpBlocklistService.block.mockResolvedValueOnce(false);

      const incident = await service.createIncident(defaultInput);
      service.triage(incident.id);
      await service.contain(incident.id);

      const updated = service.getIncident(incident.id)!;
      const ipBlockAction = updated.containmentActions.find(
        (a) => a.type === ContainmentActionType.IP_BLOCK,
      );
      expect(ipBlockAction?.success).toBe(false);
      // Phase still advances (fail-open)
      expect(updated.phase).toBe(IncidentPhase.CONTAINED);
    });

    it('should skip IP blocks when no blocklist service', async () => {
      const serviceNoBlocklist = new IncidentResponseService(
        undefined,
        mockAlertProvider,
        undefined,
      );

      const incident = await serviceNoBlocklist.createIncident(defaultInput);
      serviceNoBlocklist.triage(incident.id);
      await serviceNoBlocklist.contain(incident.id);

      const updated = serviceNoBlocklist.getIncident(incident.id)!;
      expect(updated.phase).toBe(IncidentPhase.CONTAINED);
      expect(
        updated.containmentActions.filter((a) => a.type === ContainmentActionType.IP_BLOCK),
      ).toHaveLength(0);
    });
  });

  describe('automated playbook', () => {
    it('should execute full automated sequence', async () => {
      const incident = await service.executeAutomatedPlaybook(defaultInput);

      expect(incident.phase).toBe(IncidentPhase.CONTAINED);
      expect(incident.status).toBe(IncidentStatus.IN_PROGRESS);
      expect(incident.alertedAt).toBeGreaterThan(0);
      expect(incident.containmentActions.length).toBeGreaterThan(0);
      expect(incident.phaseHistory).toHaveLength(2); // DETECTED→TRIAGED, TRIAGED→CONTAINED
    });
  });

  describe('SLA management', () => {
    it('should detect SLA breaches', async () => {
      const incident = await service.createIncident({
        ...defaultInput,
        severity: IncidentSeverity.CRITICAL,
      });

      // Manually set SLA deadline to the past
      const stored = service.getIncident(incident.id)!;
      (stored as any).slaDeadline = Date.now() - 1000;

      const breached = service.checkSlaBreaches();
      expect(breached).toHaveLength(1);
      expect(breached[0]!.slaBreached).toBe(true);
    });

    it('should not flag resolved incidents as breached', async () => {
      const incident = await service.executeAutomatedPlaybook(defaultInput);
      service.eradicate(incident.id);
      service.recover(incident.id);

      // Set SLA to past
      const stored = service.getIncident(incident.id)!;
      (stored as any).slaDeadline = Date.now() - 1000;

      const breached = service.checkSlaBreaches();
      expect(breached).toHaveLength(0);
    });
  });

  describe('query methods', () => {
    it('should return open incidents', async () => {
      await service.createIncident(defaultInput);
      await service.createIncident({ ...defaultInput, title: 'Second incident' });

      const open = service.getOpenIncidents();
      expect(open).toHaveLength(2);
    });

    it('should filter by phase', async () => {
      const incident = await service.createIncident(defaultInput);
      service.triage(incident.id);

      const triaged = service.getIncidentsByPhase(IncidentPhase.TRIAGED);
      expect(triaged).toHaveLength(1);
      expect(triaged[0]!.id).toBe(incident.id);
    });
  });
});

// ─── BreachNotificationService Tests ─────────────────────────────

describe('BreachNotificationService', () => {
  let service: BreachNotificationService;

  beforeEach(() => {
    service = new BreachNotificationService();
  });

  describe('createNotification', () => {
    it('should create a notification with 72-hour deadline', () => {
      const before = Date.now();
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Unauthorized data access',
        dataCategories: ['email', 'name', 'phone'],
        affectedUserCount: 150,
        affectedUserIds: ['user-1', 'user-2'],
        consequences: 'Personal data exposed to unauthorized party',
        mitigationMeasures: 'Passwords reset, sessions revoked',
      });

      expect(notification.id).toBeDefined();
      expect(notification.status).toBe(BreachNotificationStatus.PENDING);
      expect(notification.deadline).toBeGreaterThanOrEqual(
        before + BREACH_NOTIFICATION_DEADLINE_HOURS * 60 * 60 * 1000,
      );
      expect(notification.authorityNotifiedAt).toBeNull();
      expect(notification.usersNotifiedAt).toBeNull();
      expect(notification.deadlineMet).toBeNull();
    });
  });

  describe('notification lifecycle', () => {
    it('should track authority notification', () => {
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Data leak',
        dataCategories: ['email'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Email addresses exposed',
        mitigationMeasures: 'Accounts secured',
      });

      const updated = service.notifyAuthority(notification.id);
      expect(updated?.status).toBe(BreachNotificationStatus.AUTHORITY_NOTIFIED);
      expect(updated?.authorityNotifiedAt).toBeGreaterThan(0);
      expect(updated?.deadlineMet).toBe(true);
    });

    it('should track user notification', () => {
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Data leak',
        dataCategories: ['email'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Email addresses exposed',
        mitigationMeasures: 'Accounts secured',
      });

      service.notifyAuthority(notification.id);
      const updated = service.notifyUsers(notification.id);
      expect(updated?.status).toBe(BreachNotificationStatus.COMPLETED);
      expect(updated?.usersNotifiedAt).toBeGreaterThan(0);
    });

    it('should mark as USERS_NOTIFIED if authority not yet notified', () => {
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Data leak',
        dataCategories: ['email'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Email addresses exposed',
        mitigationMeasures: 'Accounts secured',
      });

      const updated = service.notifyUsers(notification.id);
      expect(updated?.status).toBe(BreachNotificationStatus.USERS_NOTIFIED);
    });
  });

  describe('deadline checking', () => {
    it('should detect overdue notifications', () => {
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Data leak',
        dataCategories: ['email'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Email addresses exposed',
        mitigationMeasures: 'Accounts secured',
      });

      // Manually set deadline to the past
      const stored = service.getNotification(notification.id)!;
      (stored as any).deadline = Date.now() - 1000;

      const overdue = service.checkDeadlines();
      expect(overdue).toHaveLength(1);
      expect(overdue[0]!.status).toBe(BreachNotificationStatus.OVERDUE);
      expect(overdue[0]!.deadlineMet).toBe(false);
    });

    it('should return remaining time', () => {
      const notification = service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Data leak',
        dataCategories: ['email'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Email addresses exposed',
        mitigationMeasures: 'Accounts secured',
      });

      const remaining = service.getRemainingTime(notification.id);
      expect(remaining).toBeGreaterThan(0);
      // Should be approximately 72 hours in ms
      expect(remaining!).toBeLessThanOrEqual(
        BREACH_NOTIFICATION_DEADLINE_HOURS * 60 * 60 * 1000,
      );
    });
  });

  describe('query methods', () => {
    it('should return null for non-existent notification', () => {
      expect(service.getNotification('non-existent')).toBeNull();
      expect(service.notifyAuthority('non-existent')).toBeNull();
      expect(service.getRemainingTime('non-existent')).toBeNull();
    });

    it('should get notifications by incident', () => {
      service.createNotification({
        incidentId: 'inc-1',
        breachType: 'Type A',
        dataCategories: ['email'],
        affectedUserCount: 5,
        affectedUserIds: [],
        consequences: 'Minor',
        mitigationMeasures: 'Fixed',
      });
      service.createNotification({
        incidentId: 'inc-2',
        breachType: 'Type B',
        dataCategories: ['phone'],
        affectedUserCount: 10,
        affectedUserIds: [],
        consequences: 'Moderate',
        mitigationMeasures: 'Fixed',
      });

      const results = service.getByIncident('inc-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.breachType).toBe('Type A');
    });
  });
});

// ─── PentestTrackerService Tests ─────────────────────────────────

describe('PentestTrackerService', () => {
  let service: PentestTrackerService;

  beforeEach(() => {
    service = new PentestTrackerService();
  });

  describe('penetration testing', () => {
    it('should create a pentest record', () => {
      const pentest = service.createPentest({
        quarter: '2024-Q1',
        provider: 'SecureCo',
      });

      expect(pentest.id).toBeDefined();
      expect(pentest.quarter).toBe('2024-Q1');
      expect(pentest.provider).toBe('SecureCo');
      expect(pentest.status).toBe(PentestStatus.IN_PROGRESS);
      expect(pentest.findings).toHaveLength(0);
    });

    it('should add findings with correct SLA deadlines', () => {
      const pentest = service.createPentest({
        quarter: '2024-Q1',
        provider: 'SecureCo',
      });

      const criticalFinding = service.addFinding(pentest.id, {
        title: 'RCE via deserialization',
        description: 'Critical remote code execution vulnerability',
        severity: IncidentSeverity.CRITICAL,
      });

      expect(criticalFinding).toBeDefined();
      expect(criticalFinding!.severity).toBe(IncidentSeverity.CRITICAL);
      // CRITICAL SLA = 24 hours
      const expectedDeadline =
        criticalFinding!.createdAt + SEVERITY_SLA_HOURS[IncidentSeverity.CRITICAL] * 60 * 60 * 1000;
      expect(criticalFinding!.slaDeadline).toBe(expectedDeadline);

      const updatedPentest = service.getPentest(pentest.id)!;
      expect(updatedPentest.status).toBe(PentestStatus.FINDINGS_OPEN);
    });

    it('should resolve findings and track SLA compliance', () => {
      const pentest = service.createPentest({
        quarter: '2024-Q1',
        provider: 'SecureCo',
      });

      const finding = service.addFinding(pentest.id, {
        title: 'XSS in search',
        description: 'Reflected XSS',
        severity: IncidentSeverity.MEDIUM,
      })!;

      const resolved = service.resolveFinding(pentest.id, finding.id);
      expect(resolved?.resolved).toBe(true);
      expect(resolved?.resolvedAt).toBeGreaterThan(0);
      expect(resolved?.slaBreached).toBe(false); // resolved immediately
    });

    it('should detect SLA breaches for overdue findings', () => {
      const pentest = service.createPentest({
        quarter: '2024-Q1',
        provider: 'SecureCo',
      });

      const finding = service.addFinding(pentest.id, {
        title: 'Open redirect',
        description: 'Low severity open redirect',
        severity: IncidentSeverity.LOW,
      })!;

      // Manually set SLA deadline to the past
      (finding as any).slaDeadline = Date.now() - 1000;

      const breached = service.checkSlaBreaches();
      expect(breached).toHaveLength(1);
      expect(breached[0]!.slaBreached).toBe(true);
    });

    it('should mark pentest as FINDINGS_RESOLVED when all resolved', () => {
      const pentest = service.createPentest({
        quarter: '2024-Q1',
        provider: 'SecureCo',
      });

      const f1 = service.addFinding(pentest.id, {
        title: 'Finding 1',
        description: 'Desc',
        severity: IncidentSeverity.HIGH,
      })!;
      const f2 = service.addFinding(pentest.id, {
        title: 'Finding 2',
        description: 'Desc',
        severity: IncidentSeverity.MEDIUM,
      })!;

      service.resolveFinding(pentest.id, f1.id);
      service.resolveFinding(pentest.id, f2.id);

      const updated = service.getPentest(pentest.id)!;
      expect(updated.status).toBe(PentestStatus.FINDINGS_RESOLVED);
    });

    it('should return open findings across all pentests', () => {
      const p1 = service.createPentest({ quarter: '2024-Q1', provider: 'A' });
      const p2 = service.createPentest({ quarter: '2024-Q2', provider: 'B' });

      service.addFinding(p1.id, {
        title: 'F1',
        description: 'D',
        severity: IncidentSeverity.HIGH,
      });
      const f2 = service.addFinding(p2.id, {
        title: 'F2',
        description: 'D',
        severity: IncidentSeverity.LOW,
      })!;
      service.resolveFinding(p2.id, f2.id);

      const open = service.getOpenFindings();
      expect(open).toHaveLength(1);
      expect(open[0]!.title).toBe('F1');
    });
  });

  describe('third-party security audits', () => {
    it('should create an audit record', () => {
      const audit = service.createAudit({
        period: '2024-H1',
        auditor: 'AuditFirm Inc',
        auditType: 'SOC2',
      });

      expect(audit.id).toBeDefined();
      expect(audit.period).toBe('2024-H1');
      expect(audit.auditor).toBe('AuditFirm Inc');
      expect(audit.auditType).toBe('SOC2');
      expect(audit.status).toBe(AuditStatus.IN_PROGRESS);
      expect(audit.remediationProgress).toBe(0);
    });

    it('should complete audit and schedule next one', () => {
      const audit = service.createAudit({
        period: '2024-H1',
        auditor: 'AuditFirm Inc',
        auditType: 'SOC2',
      });

      const completed = service.completeAudit(audit.id, {
        [IncidentSeverity.CRITICAL]: 0,
        [IncidentSeverity.HIGH]: 2,
        [IncidentSeverity.MEDIUM]: 5,
        [IncidentSeverity.LOW]: 8,
      });

      expect(completed?.status).toBe(AuditStatus.REMEDIATION_IN_PROGRESS);
      expect(completed?.completedAt).toBeGreaterThan(0);
      expect(completed?.nextAuditDue).toBeGreaterThan(Date.now());
    });

    it('should mark audit as COMPLETED when no findings', () => {
      const audit = service.createAudit({
        period: '2024-H1',
        auditor: 'AuditFirm Inc',
        auditType: 'ISO27001',
      });

      const completed = service.completeAudit(audit.id, {
        [IncidentSeverity.CRITICAL]: 0,
        [IncidentSeverity.HIGH]: 0,
        [IncidentSeverity.MEDIUM]: 0,
        [IncidentSeverity.LOW]: 0,
      });

      expect(completed?.status).toBe(AuditStatus.COMPLETED);
    });

    it('should track remediation progress', () => {
      const audit = service.createAudit({
        period: '2024-H1',
        auditor: 'AuditFirm Inc',
        auditType: 'SOC2',
      });

      service.completeAudit(audit.id, {
        [IncidentSeverity.CRITICAL]: 1,
        [IncidentSeverity.HIGH]: 3,
        [IncidentSeverity.MEDIUM]: 5,
        [IncidentSeverity.LOW]: 2,
      });

      service.updateRemediationProgress(audit.id, 50);
      expect(service.getAudit(audit.id)?.remediationProgress).toBe(50);

      service.updateRemediationProgress(audit.id, 100);
      expect(service.getAudit(audit.id)?.status).toBe(
        AuditStatus.REMEDIATION_COMPLETE,
      );
    });

    it('should detect when audit is due', () => {
      // No audits — should be due
      expect(service.isAuditDue()).toBe(true);

      const audit = service.createAudit({
        period: '2024-H1',
        auditor: 'AuditFirm Inc',
        auditType: 'SOC2',
      });

      service.completeAudit(audit.id, {
        [IncidentSeverity.CRITICAL]: 0,
        [IncidentSeverity.HIGH]: 0,
        [IncidentSeverity.MEDIUM]: 0,
        [IncidentSeverity.LOW]: 0,
      });

      // Just completed — not due yet
      expect(service.isAuditDue()).toBe(false);
    });
  });
});
