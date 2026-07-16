# Infrastructure Hardening & GitOps — Bilgim Platform

Bu hujjat Bilgim platformasining infratuzilma xavfsizligi va GitOps strategiyasini tavsiflaydi.

## Umumiy ko'rinish

Bilgim production infratuzilmasi quyidagi tamoyillar asosida qurilgan:

1. **Immutable Infrastructure** — serverlarga SSH kirish to'liq taqiqlangan
2. **GitOps (ArgoCD)** — barcha o'zgarishlar faqat Git orqali
3. **Network Segmentation** — database faqat application podlardan accessible
4. **Secrets Management (Vault)** — hardcoded secret yo'q
5. **Pod Security Standards** — restricted profile enforcement
6. **Drift Detection** — avtomatik aniqlash + alert + rollback

---

## 1. Immutable Infrastructure (Req 31.4)

### Printsip
Production serverlarga hech qanday manual kirish yo'q. SSH to'liq o'chirilgan.
Barcha o'zgarishlar faqat Git commit → ArgoCD sync orqali amalga oshiriladi.

### Qo'llash usullari
- SSH daemon production node larda o'chirilgan (`sshd` disabled)
- Kubernetes node larga `kubectl exec` faqat emergency break-glass orqali
- Break-glass jarayoni: PagerDuty incident → 2 ta SRE approval → vaqtinchalik access (1 soat TTL)
- Barcha node access audit logga yoziladi

### Fayl joylashuvi
```
infra/k8s/argocd/application.yaml  — ArgoCD Application manifests
```

---

## 2. GitOps — ArgoCD (Req 31.4)

### Arxitektura
```
Developer → Git Push → GitHub → ArgoCD → Kubernetes Cluster
                                   ↓
                          Self-Heal (drift rollback)
```

### ArgoCD konfiguratsiyasi
- **Repository:** `github.com/bilgim-uz/bilgim-platform`
- **Production branch:** `main`
- **Staging branch:** `develop`
- **Sync policy:** Automated + Self-Heal + Prune
- **Retry:** 3 marta, exponential backoff (5s → 10s → 20s)

### Deployment jarayoni
1. Developer feature branch da ishlaydi
2. PR ochiladi → CI pipeline (lint, test, build, security scan)
3. PR merge → `main` branch
4. ArgoCD avtomatik detect qiladi (3 daqiqa polling yoki webhook)
5. Kubernetes ga sync qilinadi
6. Health check o'tsa — deploy muvaffaqiyatli
7. Health check fail — avtomatik rollback

### ArgoCD Applications
| Application | Branch | Path | Namespace |
|---|---|---|---|
| `bilgim-production` | `main` | `infra/k8s/overlays/production` | `bilgim-production` |
| `bilgim-staging` | `develop` | `infra/k8s/overlays/staging` | `bilgim-staging` |
| `bilgim-infrastructure` | `main` | `infra/k8s/base` | `bilgim-production` |

### Fayl joylashuvi
```
infra/k8s/argocd/application.yaml
```

---

## 3. Network Segmentation (Req 31.5)

### Printsip
Default-deny policy — hech narsa ruxsat etilmagan, faqat aniq belgilangan traffic o'tadi.

### Network Policy qoidalari

| Source | Destination | Port | Ruxsat |
|---|---|---|---|
| Ingress Controller | API pods | 3000 | ✅ |
| API pods | PostgreSQL | 5432 | ✅ |
| API pods | Redis | 6379 | ✅ |
| Worker pods | PostgreSQL | 5432 | ✅ |
| Worker pods | Redis | 6379 | ✅ |
| Signaling pods | Redis | 6379 | ✅ |
| API/Worker pods | Vault | 8200 | ✅ |
| API/Worker pods | External HTTPS | 443 | ✅ |
| Public Internet | PostgreSQL | 5432 | ❌ |
| Public Internet | Redis | 6379 | ❌ |
| Any pod | Any pod (default) | * | ❌ |

### Database izolyatsiyasi
PostgreSQL va Redis faqat `app.kubernetes.io/component: api` yoki `worker` label li podlardan accessible.
Public internet dan to'g'ridan-to'g'ri kirish **imkonsiz**.

### Fayl joylashuvi
```
infra/k8s/base/network-policies.yaml
```

---

## 4. Secrets Management — HashiCorp Vault (Req 31.6)

### Printsip
**Hech qanday secret source code, Docker image yoki environment file da saqlanmaydi.**
Barcha secretlar HashiCorp Vault da markazlashtirilgan holda boshqariladi.

### Vault arxitekturasi
```
Vault Server (bilgim-vault namespace)
├── Secret Engine: KV v2 (static secrets)
│   ├── secret/data/bilgim/app (JWT, API keys)
│   ├── secret/data/bilgim/database (DB credentials)
│   ├── secret/data/bilgim/redis (Redis password)
│   ├── secret/data/bilgim/cloudflare (R2 keys)
│   ├── secret/data/bilgim/email (SMTP credentials)
│   └── secret/data/bilgim/telegram (Bot token)
├── Secret Engine: Database (dynamic credentials)
│   └── database/creds/bilgim-app (auto-rotated PostgreSQL creds)
├── Secret Engine: Transit (envelope encryption)
│   └── transit/keys/bilgim-dek (KMS for data encryption)
└── Secret Engine: PKI (TLS certificates)
    └── pki/issue/bilgim (auto-renewed TLS certs)
```

### Secret yetkazish usullari

#### 1. Vault Agent Sidecar (real-time)
- Pod ga sidecar sifatida inject qilinadi
- Secretlarni fayl sifatida `/vault/secrets/` ga yozadi
- Dynamic credentials avtomatik yangilanadi (lease renewal)
- Konfiguratsiya: `infra/k8s/vault/vault-agent-config.yaml`

#### 2. External Secrets Operator (Kubernetes-native)
- Vault dan secretlarni Kubernetes Secret ga sync qiladi
- `refreshInterval` orqali davriy yangilanadi
- Konfiguratsiya: `infra/k8s/vault/external-secrets.yaml`

### Secret rotation
| Secret turi | Rotation davri | Usul |
|---|---|---|
| Database credentials | 1 soat | Vault Dynamic Secrets |
| JWT signing keys | 90 kun | KMS key rotation |
| API keys | 6 oy | Manual + Vault KV versioning |
| TLS certificates | 30 kun | Vault PKI auto-renewal |
| Encryption keys (DEK) | 90 kun | KMS envelope rotation |

### Fayl joylashuvi
```
infra/k8s/vault/vault-agent-config.yaml
infra/k8s/vault/external-secrets.yaml
```

---

## 5. Pod Security Standards — Restricted Profile (Req 31.9)

### Printsip
Kubernetes Pod Security Standards (PSS) restricted profile — eng qattiq xavfsizlik darajasi.

### Taqiqlangan amallar
| Amal | Holat | Enforcement |
|---|---|---|
| Privileged containers | ❌ Taqiqlangan | Namespace label + VAP |
| Host network | ❌ Taqiqlangan | Namespace label + VAP |
| Host PID/IPC | ❌ Taqiqlangan | Namespace label + VAP |
| Root user (UID 0) | ❌ Taqiqlangan | VAP + securityContext |
| Privilege escalation | ❌ Taqiqlangan | VAP |
| hostPath volumes | ❌ Taqiqlangan | VAP |
| Writable root filesystem | ❌ Taqiqlangan | VAP |
| All capabilities | ❌ Drop ALL | VAP |
| Seccomp profile | ✅ RuntimeDefault majburiy | VAP |

### Enforcement mexanizmlari (defense-in-depth)

1. **Namespace PSS Labels** (birlamchi):
   ```yaml
   pod-security.kubernetes.io/enforce: restricted
   pod-security.kubernetes.io/audit: restricted
   pod-security.kubernetes.io/warn: restricted
   ```

2. **ValidatingAdmissionPolicy** (ikkilamchi):
   - `bilgim-deny-privileged` — privileged, hostNetwork, hostPID, hostIPC
   - `bilgim-enforce-nonroot` — runAsNonRoot, allowPrivilegeEscalation, capabilities
   - `bilgim-readonly-rootfs` — readOnlyRootFilesystem
   - `bilgim-deny-hostpath` — hostPath volumes
   - `bilgim-enforce-seccomp` — seccomp RuntimeDefault

### Pod securityContext namunasi
```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    fsGroup: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: api
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        capabilities:
          drop:
            - ALL
```

### Fayl joylashuvi
```
infra/k8s/base/namespace.yaml
infra/k8s/base/pod-security-policy.yaml
```

---

## 6. Drift Detection + Alert + Rollback (Req 31.10)

### Printsip
Har qanday manual o'zgarish (kubectl edit, kubectl apply) avtomatik aniqlanadi,
alert yuboriladi va ArgoCD orqali rollback qilinadi.

### Arxitektura
```
CronJob (har 5 daqiqa)
├── ArgoCD sync status tekshiruvi
├── PSS violation tekshiruvi (root containers)
├── Privileged container tekshiruvi
├── Network policy mavjudligi tekshiruvi
└── Namespace label tekshiruvi
         │
         ▼ (drift aniqlansa)
    ┌─────────────┐
    │ Alert yuborish │
    ├─────────────┤
    │ • Slack      │
    │ • PagerDuty  │
    └─────────────┘
         │
         ▼
    ┌──────────────────┐
    │ ArgoCD hard refresh │
    │ (avtomatik rollback) │
    └──────────────────┘
```

### ArgoCD Self-Heal
ArgoCD `selfHeal: true` konfiguratsiyasi tufayli:
- Manual `kubectl` o'zgarishlar 3 daqiqa ichida avtomatik rollback qilinadi
- Drift detection CronJob qo'shimcha himoya sifatida ishlaydi
- PrometheusRule alert lar monitoring tizimiga integratsiya qilingan

### Prometheus Alerts
| Alert | Condition | Severity |
|---|---|---|
| `InfrastructureDriftDetected` | Drift CronJob failed | Critical |
| `DriftDetectionNotRunning` | CronJob 10 daqiqa ishlamagan | Warning |
| `ArgoCDOutOfSync` | App 5 daqiqa OutOfSync | Critical |

### Fayl joylashuvi
```
infra/k8s/drift-detection/drift-alert.yaml
```

---

## Fayl tuzilmasi

```
infra/
├── k8s/
│   ├── base/
│   │   ├── namespace.yaml              # PSS-enforced namespaces
│   │   ├── network-policies.yaml       # Network segmentation
│   │   └── pod-security-policy.yaml    # ValidatingAdmissionPolicy (PSS restricted)
│   ├── argocd/
│   │   └── application.yaml            # ArgoCD GitOps applications
│   ├── vault/
│   │   ├── vault-agent-config.yaml     # Vault Agent sidecar config
│   │   └── external-secrets.yaml       # ExternalSecrets operator config
│   └── drift-detection/
│       └── drift-alert.yaml            # Drift CronJob + PrometheusRule
└── security/
    └── infrastructure/
        └── README.md                   # Bu hujjat
```

---

## Requirements Mapping

| Requirement | Fayl | Holat |
|---|---|---|
| 31.4 — Immutable infrastructure, SSH taqiqlash | `argocd/application.yaml`, `namespace.yaml` | ✅ |
| 31.4 — GitOps (ArgoCD) orqali barcha o'zgarishlar | `argocd/application.yaml` | ✅ |
| 31.5 — Network segmentation (DB isolation) | `base/network-policies.yaml` | ✅ |
| 31.6 — Vault orqali secrets boshqaruvi | `vault/vault-agent-config.yaml`, `vault/external-secrets.yaml` | ✅ |
| 31.9 — Pod Security Standards (restricted) | `base/namespace.yaml`, `base/pod-security-policy.yaml` | ✅ |
| 31.9 — Privileged/hostNetwork/root taqiqlash | `base/pod-security-policy.yaml` | ✅ |
| 31.10 — Drift detection + alert + rollback | `drift-detection/drift-alert.yaml` | ✅ |

---

## Operatsion qo'llanma

### Yangi secret qo'shish
```bash
# 1. Vault ga secret yozish
vault kv put secret/bilgim/app new_key="value"

# 2. External Secret ga qo'shish (infra/k8s/vault/external-secrets.yaml)
# 3. Git commit + push → ArgoCD sync
```

### Emergency break-glass (faqat incident paytida)
```bash
# 1. PagerDuty incident yaratish
# 2. 2 ta SRE approval olish
# 3. Vaqtinchalik kubeconfig olish (1 soat TTL)
vault read auth/kubernetes/login role=emergency-access
# 4. Incident tugagach access avtomatik expire bo'ladi
```

### Drift tekshirish (manual)
```bash
kubectl create job --from=cronjob/drift-detection manual-drift-check \
  -n bilgim-production
kubectl logs -f job/manual-drift-check -n bilgim-production
```

---

## Xavfsizlik mulohazalari

- Vault unsealing uchun Shamir's Secret Sharing (3/5 threshold) ishlatiladi
- ArgoCD admin parol Vault da saqlanadi, OIDC orqali SSO tavsiya etiladi
- Network policies `default-deny-all` dan boshlanadi — faqat aniq ruxsat etilgan traffic
- Drift detection CronJob o'zi ham PSS restricted profile da ishlaydi
- Barcha container image lar cosign bilan imzolangan (Req 31.3)
- Base image lar distroless/Alpine, pinned sha256 digest (Req 31.8)
