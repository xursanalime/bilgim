# Design Document

> **Content Protection — Backend (API & Media) Technical Design**
> Companion to `requirements.md`. Implements the server side of the `frontend-redesign` content-protection pillar (its §3) inside `apps/api` + `app/api/media` BFF.

## Overview

This design adds **encryption, access control, and traceability** to media delivery so that piracy is impractical and any leak is attributable. It is **provider-backed and provider-agnostic**: a managed multi-DRM + watermarking vendor (`DRM_Provider`) does the heavy lifting (encryption, license issuance, forensic watermarking) behind a thin `ProtectionProvider` port, while the API owns entitlement checks, ticket signing, license brokering, and gated file streaming.

The current baseline (HLS proxy hiding R2 URLs + client JS deterrence, no DRM, no watermark, restricted files still resolve to signed URLs) is replaced for protected content. A clearly-flagged development fallback preserves local workflows until the provider is configured.

## Architecture

```
Client (Shaka/EME)  ──ticket──►  Web BFF (/api/media/*)  ──►  Bilgim API (apps/api modules/media + protection)  ──►  DRM_Provider
                    ◄─license──                          ◄──  (entitlement, ticket sign, license broker, watermark id)
                                                              │
                                                              ├─ catalog/enrollment (Entitlement: APPROVED?)
                                                              ├─ media (MediaAsset, packaging/encryption or provider)
                                                              └─ live (recording finalize → MediaAsset)
```

- New `modules/protection` (or extension of `modules/media`) owns: Playback_Ticket issuance, License_Proxy, watermark identity, gated file streaming, session logging.
- The Web BFF (`apps/web/app/api/media/*`) calls the API; vendor URLs/keys never reach the browser.
- Entitlement reuses the existing `LessonAccessGuard`/enrollment checks.

## Components and Interfaces

| Component | Responsibility | Endpoint (proposed) |
|---|---|---|
| `PlaybackTicketService` | Verify entitlement, sign short-lived ticket, attach watermark identity + `downloadAllowed` | `GET /media/assets/:id/playback-ticket?lessonId=` |
| `LicenseProxyController` | Broker EME challenges to DRM_Provider for Widevine/FairPlay/PlayReady; verify ticket+entitlement | `POST /media/assets/:id/license/:keySystem` |
| `ProtectedFileController` | Stream gated files (inline vs attachment by Download_Permission); never expose storage URL | `GET /media/assets/:id/stream` |
| `WatermarkIdentityService` | Derive per-viewer label/session tag from auth session | internal |
| `ProtectionProvider` (port) | Vendor-agnostic adapter: package/encrypt, issue license, bind watermark | internal (adapter per vendor) |
| `RecordingFinalizer` | On LiveSession end → MediaAsset on lesson, ENDED/RECORDING_FAILED | live module hook |
| `PlaybackSessionLog` | Persist viewer↔session↔asset mapping for tracing | repository + admin lookup |

```ts
// Port the API depends on (adapters: VdoCipher | Gumlet | Mux | DevFallback)
interface ProtectionProvider {
  getSignedManifest(assetId: string, ttlSec: number): Promise<{ manifestUrl: string }>;
  issueLicense(input: { keySystem: 'widevine'|'fairplay'|'playready'; challenge: Buffer; viewerTag: string }): Promise<Buffer>;
  bindWatermark(assetId: string, viewerTag: string): Promise<{ sessionTag?: string }>;
}
```

## Data Models

Additions to `packages/db/prisma/schema.prisma`:

- **Group**: `downloadAllowed Boolean @default(false)` (server-authoritative Download_Permission).
- **PlaybackSession**: id, assetId, lessonId, viewerUserId, enrollmentId, viewerTag (watermark label), drmKeySystem, issuedAt, expiresAt, ip/userAgent (for tracing). Indexed by `viewerTag` and `assetId`.
- **MediaAsset**: optional protection metadata (`drmPackaged Boolean`, `providerAssetId String?`) to track encryption/packaging state.
- Reuse existing **Recording**/**LiveSession**/**Attachment**; no breaking changes.

Configuration (secrets, not DB): DRM provider keys, FairPlay certificate, ticket TTL, session-log retention, watermark format.

## Correctness Properties

### Property 1: No media URL without entitlement
A Playback_Ticket or any media URL is issued only to a caller with an APPROVED Entitlement; otherwise nothing is returned.
**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Keys stay server-side
DRM_Provider credentials/keys are never present in any client-facing response; licenses are only returned after ticket+entitlement validation.
**Validates: Requirements 2.2, 2.3, 2.4**

### Property 3: Download gating is server-enforced
Restricted files are never served as a downloadable/attachment response to learners while Download_Permission is disabled, regardless of client flags.
**Validates: Requirements 4.1, 4.2, 4.4**

### Property 4: Watermark bound to session server-side
Every Playback_Ticket carries a watermark identity derived from the authenticated session, and a PlaybackSession row records the mapping.
**Validates: Requirements 3.1, 3.3, 6.1**

### Property 5: Fail closed in production
When the DRM_Provider is unavailable, protected playback fails closed; no unprotected production fallback is served.
**Validates: Requirements 7.3**

### Property 6: Recording finalization terminal state
A LiveSession always reaches ENDED or RECORDING_FAILED, and a successful recording is playable only via the protected path.
**Validates: Requirements 5.1, 5.2, 5.3**

## Error Handling

- Entitlement/ticket failures → `403` authorization error, no media payload.
- License validation failure → refuse license (no key).
- DRM_Provider unavailable → fail closed for protected playback with actionable error (Req 7.3).
- Restricted download attempt → `403`/inline-only, never attachment (Req 4.2).
- Recording finalization failure → RECORDING_FAILED + status surfaced (Req 5.3).
- Dev fallback path is explicitly flagged in logs/responses as non-production protection (Req 7.2).

## Testing Strategy

- **Unit:** ticket signing/expiry, entitlement checks, watermark identity derivation, download-gating decision, fail-closed behavior.
- **Property-based (fast-check, repo style):** Properties 1–6 (esp. no-URL-without-entitlement, keys-server-side, gating).
- **Integration:** ticket → license proxy → playback with a mock `ProtectionProvider`; negative tests proving a non-entitled caller and a restricted-file download both fail; live recording finalize → protected playback.
- **Security review:** verify no vendor key/URL appears in any client response; verify dev fallback cannot be mistaken for production protection.
- **Manual validation** (with `frontend-redesign` task 15.2): end-to-end capture/screenshot behavior once a provider is wired, recording honest partial-effectiveness.
