# Supply Chain Security — Bilgim Platform

> Bu hujjat Bilgim platformasining dasturiy ta'minot yetkazib berish zanjiri xavfsizligi
> (supply chain security) choralarini tavsiflaydi.
>
> **Validates:** Requirements 31.1, 31.2, 31.3, 31.7, 31.8

---

## Umumiy ko'rinish

Supply chain security — bu dasturiy ta'minot yaratish va yetkazib berish jarayonidagi barcha
bosqichlarni himoyalash strategiyasi. Bilgim quyidagi himoya qatlamlarini qo'llaydi:

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT GATE                           │
│  (Security Gate job — barcha tekshiruvlar o'tishi shart)    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Snyk    │  │  Trivy   │  │  cosign  │  │   SBOM   │  │
│  │  (SCA)   │  │  (Image) │  │  (Sign)  │  │(CycloneDX)│  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│              Kubernetes Admission Controller                 │
│  (Imzolanmagan image → REJECT)                             │
├─────────────────────────────────────────────────────────────┤
│              Dependabot (avtomatik yangilanish)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Dependency Scanning (Req 31.1)

### Snyk Integration

**Maqsad:** Ochiq kodli kutubxonalardagi ma'lum zaifliklarni (CVE) aniqlash.

**Qanday ishlaydi:**
- CI/CD pipeline da har bir push va PR da Snyk skanerlash ishga tushadi
- `--severity-threshold=high` — faqat HIGH va CRITICAL zaifliklar deploy ni bloklaydi
- `--all-projects` — monorepo dagi barcha workspace paketlarni skanerlaydi
- Natijalar SARIF formatida GitHub Security tab ga yuklanadi

**Konfiguratsiya:** `.github/workflows/security-scan.yml` → `snyk-scan` job

**Secrets kerak:**
- `SNYK_TOKEN` — Snyk dashboard dan olinadi

### Dependabot

**Maqsad:** Dependency larni avtomatik yangilash va xavfsizlik patch larni tezkor qo'llash.

**Qanday ishlaydi:**
- Har hafta dushanba kuni npm dependency larni tekshiradi
- Seshanba kuni Docker base image yangilanishlarini tekshiradi
- Chorshanba kuni GitHub Actions versiyalarini tekshiradi
- Security update lar alohida PR sifatida darhol yaratiladi
- Production va dev dependency lar guruhlarga ajratilgan

**Konfiguratsiya:** `.github/dependabot.yml`

---

## 2. Container Image Scanning (Req 31.2)

### Trivy Integration

**Maqsad:** Container image lardagi OS paketlar va kutubxonalardagi zaifliklarni aniqlash.

**Qanday ishlaydi:**
- Har bir image build dan keyin Trivy skanerlash ishga tushadi
- CRITICAL va HIGH zaifliklar topilsa — deploy **to'xtatiladi** (`exit-code: 1`)
- Natijalar SARIF formatida GitHub Security tab ga yuklanadi
- Table formatida ham log ga chiqariladi (debugging uchun)

**Konfiguratsiya:** `.github/workflows/security-scan.yml` → `trivy-scan` job

**Skanerlash strategiyasi:**
- `api` image — NestJS backend (distroless base)
- `web` image — Next.js frontend (Alpine base)

---

## 3. Image Signing (Req 31.3)

### cosign (Sigstore) Keyless Signing

**Maqsad:** Production image larning haqiqiyligini kriptografik imzo bilan tasdiqlash.

**Qanday ishlaydi:**
- GitHub Actions OIDC token orqali keyless signing (kalit boshqarish kerak emas)
- Fulcio CA sertifikat beradi, Rekor transparency log ga yoziladi
- Imzolash faqat `main` branch va tag push larda amalga oshadi
- Trivy scan muvaffaqiyatli o'tgandan keyingina imzolanadi

**Verification:**
```bash
# Image imzosini tekshirish
cosign verify \
  --certificate-identity-regexp "https://github.com/xursanalime/bilgimAI/*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/xursanalime/bilgimai/api@sha256:...
```

### Kubernetes Admission Controller

**Maqsad:** Imzolanmagan image larning cluster ga deploy qilinishini oldini olish.

**Qanday ishlaydi:**
- Sigstore Policy Controller cluster ga o'rnatiladi
- `ClusterImagePolicy` faqat bizning GitHub Actions dan imzolangan image larni qabul qiladi
- `bilgim` namespace `policy.sigstore.dev/include=true` label bilan belgilanadi
- Imzosiz yoki noto'g'ri imzoli image → **REJECT**

**O'rnatish:**
```bash
# Sigstore Policy Controller o'rnatish
helm repo add sigstore https://sigstore.github.io/helm-charts
helm install policy-controller sigstore/policy-controller \
  --namespace cosign-system --create-namespace

# Namespace ni belgilash
kubectl label ns bilgim policy.sigstore.dev/include=true

# Policy ni qo'llash
kubectl apply -f infra/k8s/admission/image-policy.yaml
```

**Konfiguratsiya:** `infra/k8s/admission/image-policy.yaml`

---

## 4. SBOM Generation (Req 31.7)

### CycloneDX Format

**Maqsad:** Har bir release uchun dasturiy ta'minot tarkibi ro'yxatini (SBOM) yaratish.

**Qanday ishlaydi:**
- Syft tool orqali container image dan SBOM generatsiya qilinadi
- Format: CycloneDX JSON (industry standard)
- `main` branch push va tag release larda ishga tushadi
- SBOM artifact sifatida 90 kun saqlanadi
- Tag release larda GitHub Release ga biriktiriladi

**SBOM tarkibi:**
- OS paketlar (Alpine/Debian)
- Node.js runtime versiyasi
- npm/pnpm dependency lar (to'liq daraxt)
- Prisma client va native bindings

**Foydalanish:**
```bash
# SBOM ni tekshirish (lokal)
syft scan ghcr.io/xursanalime/bilgimai/api:latest -o cyclonedx-json

# SBOM ni vulnerability scanner bilan tekshirish
grype sbom:sbom-api.cdx.json
```

---

## 5. Base Image Strategy (Req 31.8)

### Pinned Versions (sha256 digest)

**Maqsad:** Reproducible build lar va tag-mutability hujumlaridan himoya.

**Strategiya:**
- Barcha base image lar `@sha256:...` digest bilan pin qilingan
- Dependabot har hafta yangi digest larni tekshiradi va PR yaratadi
- Tag (`node:20-alpine`) o'rniga digest ishlatiladi

### Minimal Images

| Image | Base | Sabab |
|-------|------|-------|
| API | `gcr.io/distroless/nodejs20-debian12` | Shell yo'q, package manager yo'q — minimal attack surface |
| Web | `node:20-alpine` (stripped) | Next.js `sharp` uchun libc kerak; keraksiz paketlar o'chirilgan |

**Distroless afzalliklari:**
- Shell mavjud emas → RCE exploit qiyinlashadi
- Package manager yo'q → runtime da dependency o'rnatib bo'lmaydi
- Faqat Node.js runtime + libc → CVE yuzasi minimal

---

## 6. Pipeline oqimi

```
PR yaratildi
    │
    ├── Snyk scan (dependency CVE) ──── FAIL → PR merge blocked
    │
    ├── Docker build (multi-stage)
    │       │
    │       ├── Trivy scan (image CVE) ── FAIL → PR merge blocked
    │       │
    │       └── (PR da imzolanmaydi)
    │
    └── Security Gate ─── ALL PASS → PR merge allowed

main branch push / tag
    │
    ├── Snyk scan
    ├── Docker build + push to GHCR
    │       │
    │       ├── Trivy scan ──── FAIL → deploy blocked
    │       │
    │       ├── SBOM generate (CycloneDX)
    │       │
    │       └── cosign sign (keyless) ── FAIL → deploy blocked
    │
    └── Security Gate ─── ALL PASS → deploy allowed
                                          │
                                          ▼
                              Kubernetes Admission
                              (cosign verify → ALLOW/REJECT)
```

---

## 7. Lokal development

Lokal development da supply chain security tekshiruvlari **ixtiyoriy**:

```bash
# Lokal Trivy scan
trivy image bilgim-api:dev

# Lokal SBOM generatsiya
syft scan bilgim-api:dev -o cyclonedx-json > sbom-local.json

# Lokal Snyk scan
snyk test --all-projects
```

---

## 8. Incident Response

Agar supply chain buzilishi aniqlansa:

1. **Darhol:** Zaif image ni rollback qilish (ArgoCD orqali)
2. **Triage:** SBOM orqali ta'sirlangan komponentlarni aniqlash
3. **Patch:** Zaiflikni tuzatish va yangi image build/sign/deploy
4. **Audit:** Rekor transparency log dan imzo tarixini tekshirish
5. **Post-mortem:** Qanday qilib zaiflik pipeline dan o'tganini tahlil qilish

---

## 9. Kerakli Secrets va Environment Variables

| Secret | Qayerda | Maqsad |
|--------|---------|--------|
| `SNYK_TOKEN` | GitHub Secrets | Snyk API autentifikatsiya |
| `GITHUB_TOKEN` | Avtomatik | GHCR push + cosign signing |
| `COSIGN_EXPERIMENTAL=1` | Workflow env | Keyless signing yoqish |

---

## 10. Monitoring va Alerting

- **GitHub Security tab** — barcha SARIF natijalar ko'rinadi
- **Dependabot alerts** — yangi CVE lar uchun avtomatik alert
- **Snyk dashboard** — dependency health monitoring
- **Rekor transparency log** — imzo audit trail

---

## Fayllar ro'yxati

| Fayl | Maqsad |
|------|--------|
| `.github/workflows/security-scan.yml` | CI/CD security pipeline |
| `.github/dependabot.yml` | Avtomatik dependency yangilash |
| `infra/k8s/admission/image-policy.yaml` | K8s admission controller |
| `infra/docker/Dockerfile.api` | API production image (distroless) |
| `infra/docker/Dockerfile.web` | Web production image (Alpine) |
| `infra/security/supply-chain/README.md` | Ushbu hujjat |
