# SOC 2 Type II Compliance Controls

> **Validates: Requirement 32.1**
>
> EduBridge platformasi uchun SOC 2 Type II nazorat mexanizmlari.
> Trust Service Criteria (TSC) asosida tashkil etilgan.

---

## 1. Overview

SOC 2 Type II audit platformaning xavfsizlik, mavjudlik va maxfiylik bo'yicha
nazorat mexanizmlarining **vaqt davomida** (odatda 6-12 oy) samarali ishlashini baholaydi.

**Audit davri:** Yiliga 1 marta (12 oylik davr)
**Auditor:** Mustaqil tashqi CPA firmasi
**Scope:** EduBridge SaaS platformasi (API, Web, Infrastructure)

---

## 2. Trust Service Categories

### 2.1 Security (Common Criteria — CC)

| Control ID | Control | Implementation | Evidence |
|---|---|---|---|
| CC1.1 | COSO Internal Environment | Xavfsizlik siyosati hujjatlashtirilgan, jamoa a'zolari imzolagan | Policy docs, signed acknowledgments |
| CC1.2 | Board Oversight | Har chorakda xavfsizlik hisoboti boshqaruvga taqdim etiladi | Quarterly security reports |
| CC1.3 | Management Philosophy | Security-first madaniyat, DevSecOps amaliyotlari | Training records, CI/CD configs |
| CC1.4 | Organizational Structure | Rollar va mas'uliyatlar aniq belgilangan (RACI matrix) | Org chart, RACI docs |
| CC2.1 | Information Communication | Xavfsizlik hodisalari haqida ichki kommunikatsiya | Incident Slack channel, PagerDuty |
| CC2.2 | Internal Communication | Haftalik security standup, oylik retrospektiv | Meeting notes, Jira tickets |
| CC2.3 | External Communication | Privacy policy, terms of service, breach notification | Public docs, notification templates |
| CC3.1 | Risk Assessment | Har chorakda risk assessment o'tkaziladi | Risk register, assessment reports |
| CC3.2 | Risk Identification | Threat modeling (STRIDE), vulnerability scanning | Threat models, scan reports |
| CC3.3 | Fraud Risk | Payme webhook integrity, anti-fraud monitoring | Audit logs, anomaly alerts |
| CC3.4 | Change Impact Analysis | Har bir PR xavfsizlik ta'sirini baholash | PR reviews, security labels |

### 2.2 Access Control (CC6)

| Control ID | Control | Implementation | Evidence |
|---|---|---|---|
| CC6.1 | Logical Access Security | RBAC (STUDENT, TEACHER, ADMIN), JWT + refresh token | Auth module code, access logs |
| CC6.2 | User Registration | Email verification, onboarding flow | Registration logs, verification records |
| CC6.3 | Access Provisioning | Role-based, principle of least privilege | IAM policies, role assignments |
| CC6.4 | Access Restriction | Enrollment-gated content, teacher ownership checks | Guard implementations, test results |
| CC6.5 | Access Revocation | Session invalidation, token rotation, account deactivation | Revocation logs, automated scripts |
| CC6.6 | System Boundaries | Network segmentation, WAF, API gateway | Infrastructure diagrams, firewall rules |
| CC6.7 | Data Transmission | TLS 1.3, HSTS, encrypted webhooks | TLS configs, certificate records |
| CC6.8 | Unauthorized Access Prevention | Rate limiting, IP allowlists, MFA for admin | Rate limit configs, MFA enrollment |

### 2.3 Change Management (CC8)

| Control ID | Control | Implementation | Evidence |
|---|---|---|---|
| CC8.1 | Infrastructure Changes | IaC (Terraform/Pulumi), PR-based changes, no manual edits | Git history, drift detection alerts |
| CC8.2 | Software Changes | CI/CD pipeline, automated testing, code review | GitHub Actions logs, PR approvals |
| CC8.3 | Emergency Changes | Hotfix process with post-hoc review within 24h | Emergency PR template, review records |
| CC8.4 | Change Authorization | Minimum 1 reviewer for PRs, CODEOWNERS for critical paths | Branch protection rules, CODEOWNERS |
| CC8.5 | Configuration Management | Environment configs in secrets manager, no hardcoded secrets | Vault/SSM configs, Semgrep scans |
| CC8.6 | Baseline Configurations | Docker images pinned, dependencies locked (pnpm-lock.yaml) | Lockfiles, Dockerfile configs |

### 2.4 Risk Assessment (CC9)

| Control ID | Control | Implementation | Evidence |
|---|---|---|---|
| CC9.1 | Risk Mitigation | Identified risks have mitigation plans with owners | Risk register with status |
| CC9.2 | Vendor Risk | Third-party dependencies scanned (Snyk SCA) | SCA reports, vendor assessments |
| CC9.3 | Business Continuity | Disaster recovery plan, RTO < 4h, RPO < 1h | DR plan, backup test results |
| CC9.4 | Incident Response | Automated playbook: detect → alert → contain → recover | Incident runbooks, drill records |

---

## 3. Monitoring & Evidence Collection

### 3.1 Automated Controls

```yaml
# Avtomatik nazorat mexanizmlari
continuous_monitoring:
  - name: "Access Review"
    frequency: "Monthly"
    tool: "Custom script + audit logs"
    description: "Barcha foydalanuvchi ruxsatlarini ko'rib chiqish"

  - name: "Vulnerability Scanning"
    frequency: "Every PR + Weekly"
    tool: "Semgrep (SAST) + OWASP ZAP (DAST) + Snyk (SCA)"
    description: "Kod va dependency zaifliklarini aniqlash"

  - name: "Infrastructure Drift Detection"
    frequency: "Every 6 hours"
    tool: "Terraform plan + custom drift detector"
    description: "Manual infra o'zgarishlarni aniqlash"

  - name: "Audit Log Integrity"
    frequency: "Daily"
    tool: "Hash chain verification script"
    description: "Audit log tamper-proof ekanligini tekshirish"

  - name: "Backup Verification"
    frequency: "Weekly"
    tool: "Automated restore test"
    description: "Backup dan tiklash imkoniyatini tekshirish"

  - name: "Certificate Expiry"
    frequency: "Daily"
    tool: "cert-manager + alerting"
    description: "TLS sertifikat muddatini kuzatish"
```

### 3.2 Manual Controls

| Control | Frequency | Responsible | Documentation |
|---|---|---|---|
| Security awareness training | Quarterly | Security Lead | Training completion records |
| Penetration testing | Quarterly | External vendor | Pentest reports |
| Access review (privileged) | Monthly | Engineering Manager | Review sign-off docs |
| Incident response drill | Semi-annually | Security Team | Drill reports, lessons learned |
| Vendor security assessment | Annually | Security Lead | Vendor questionnaires |
| Policy review & update | Annually | CTO + Security Lead | Updated policy docs |

---

## 4. Incident Response Framework

### 4.1 Severity Levels

| Level | Description | Response Time | Example |
|---|---|---|---|
| SEV-1 (Critical) | Data breach, full system compromise | 15 min | Database leak, RCE exploit |
| SEV-2 (High) | Partial compromise, significant risk | 1 hour | Auth bypass, privilege escalation |
| SEV-3 (Medium) | Limited impact, contained | 4 hours | XSS in non-critical page |
| SEV-4 (Low) | Minimal impact, informational | 24 hours | Information disclosure |

### 4.2 Response Playbook

```
1. DETECTION
   ├── Automated: WAF alerts, anomaly detection, SIEM correlation
   ├── Manual: Bug bounty reports, user complaints
   └── Timeline: Alert within 5 minutes of detection

2. TRIAGE
   ├── Assign severity level
   ├── Identify affected systems and data
   └── Notify incident commander

3. CONTAINMENT
   ├── Automated: IP block, session revoke, feature flag disable
   ├── Manual: Network isolation, credential rotation
   └── Timeline: Within 30 minutes (SEV-1/2)

4. ERADICATION
   ├── Root cause analysis
   ├── Patch deployment
   └── Verification scan

5. RECOVERY
   ├── Service restoration
   ├── Data integrity verification
   └── Monitoring enhancement

6. POST-MORTEM
   ├── Blameless retrospective within 48h
   ├── Action items with owners and deadlines
   └── Process improvements documented
```

---

## 5. Vulnerability Management SLA

| Severity | Remediation SLA | Escalation |
|---|---|---|
| Critical (CVSS 9.0-10.0) | 24 soat | Immediate — CTO + Security Lead |
| High (CVSS 7.0-8.9) | 7 kun | Engineering Manager |
| Medium (CVSS 4.0-6.9) | 30 kun | Sprint planning |
| Low (CVSS 0.1-3.9) | 90 kun | Backlog |

---

## 6. CI/CD Security Controls

### 6.1 Pipeline Security

| Stage | Tool | Action on Failure |
|---|---|---|
| Pre-commit | Semgrep (local) | Block commit |
| PR Check | Semgrep SAST | Block merge |
| PR Check | Snyk SCA | Block merge (critical/high) |
| Post-merge | OWASP ZAP DAST | Alert + block deploy |
| Pre-deploy | Trivy container scan | Block deploy |
| Post-deploy | Security headers check | Alert |

### 6.2 Secrets Management

- Hech qanday secret kod ichida saqlanmaydi (Semgrep secrets rule)
- GitHub Actions secrets + environment protection rules
- Production secrets: AWS SSM Parameter Store / HashiCorp Vault
- Secret rotation: har 90 kunda (automated)

### 6.3 Code Review Requirements

- Minimum 1 approval for all PRs
- CODEOWNERS for security-critical paths:
  - `apps/api/src/common/auth/**` → @security-team
  - `apps/api/src/common/crypto/**` → @security-team
  - `infra/**` → @platform-team
  - `.github/workflows/**` → @platform-team

---

## 7. Data Protection Controls

### 7.1 Encryption

| Data State | Method | Key Management |
|---|---|---|
| At rest (DB) | AES-256-GCM (field-level) | KMS with auto-rotation |
| At rest (files) | R2 server-side encryption | Cloudflare managed |
| In transit | TLS 1.3 | cert-manager + Let's Encrypt |
| Backups | AES-256-GCM | Separate backup key in KMS |

### 7.2 Data Classification

| Level | Examples | Controls |
|---|---|---|
| Restricted | Passwords, payment tokens, encryption keys | KMS, no logging, access audit |
| Confidential | PII (email, phone), submissions | Field encryption, access control |
| Internal | Course content, schedules | Authentication required |
| Public | Discovery profiles, published courses | No special controls |

---

## 8. Audit Evidence Repository

```
infra/security/compliance/
├── soc2-controls.md          ← Bu hujjat
├── security-headers-checklist.md
├── evidence/
│   ├── access-reviews/       ← Oylik access review natijalari
│   ├── pentest-reports/      ← Choraklik pentest hisobotlari
│   ├── training-records/     ← Xavfsizlik treningi qatnashchilari
│   ├── incident-reports/     ← Hodisa hisobotlari va post-mortemlar
│   ├── risk-assessments/     ← Choraklik risk baholash
│   └── change-records/       ← O'zgarishlar tarixi (auto-generated from Git)
└── policies/
    ├── information-security-policy.md
    ├── acceptable-use-policy.md
    ├── incident-response-policy.md
    ├── data-retention-policy.md
    └── vendor-management-policy.md
```

---

## 9. Compliance Calendar

| Oy | Faoliyat |
|---|---|
| Har oy | Access review, vulnerability scan review |
| Har chorak | Risk assessment, penetration testing, security training |
| Har 6 oy | Incident response drill, policy review |
| Har yil | SOC 2 Type II audit, third-party security audit |

---

## 10. Responsible Parties

| Role | Responsibility |
|---|---|
| CTO | Overall security accountability, audit liaison |
| Security Lead | Day-to-day security operations, incident commander |
| Engineering Manager | Change management, access provisioning |
| DevOps Engineer | Infrastructure security, monitoring |
| All Engineers | Secure coding, code review, incident reporting |
