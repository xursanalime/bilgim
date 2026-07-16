# Requirements Document

> **Content Protection — Backend (API & Media) Support for Anti-Piracy**

## Introduction

Bilgim's value to instructors depends on protecting their lesson videos, live recordings, and files from leaking to YouTube/Telegram. The `frontend-redesign` spec defines the **client** behavior (DRM player, watermark overlay, download gating, deterrence) and explicitly flags **backend dependencies** that do not exist yet in `apps/api`. This spec defines the **server-side** capabilities needed to make that protection real: short-lived signed playback tickets, multi-DRM license brokering, per-viewer watermark identity, hardened (gated) file streaming, and leak detection/response support.

The current implementation (audited) protects media only via an HLS proxy that hides R2 URLs plus client-side JS deterrence — there is **no DRM encryption and no forensic watermark**, and restricted files still resolve to signed URLs. This spec closes that gap on the backend.

### Honest limitation (recorded up front)

As established in `frontend-redesign`, complete prevention of screen capture on the web is not technically possible. The backend's job is to provide **encryption, access control, and traceability** so that piracy is impractical and any leak is attributable to a specific learner. Absolute prevention is explicitly out of scope and must not be implied.

## Glossary

- **API**: The NestJS backend in `apps/api`.
- **Media_Service**: The existing media module (MediaAsset, transcoding, HLS) plus new protection responsibilities.
- **DRM_Provider**: The managed multi-DRM + watermarking vendor (e.g. VdoCipher/Gumlet/Mux) selected in `frontend-redesign` Open Question 1, integrated server-side.
- **Playback_Ticket**: A short-lived, signed authorization object the client uses to start protected playback.
- **License_Proxy**: API endpoint that brokers EME license challenges between the client CDM and the DRM_Provider, holding vendor keys server-side.
- **Forensic_Watermark_Identity**: The per-viewer label/session tag bound to a playback session for leak tracing.
- **Download_Permission**: Per-Group setting controlling whether learners may download Protected_Content.
- **Protected_Content**: Lesson videos, live recordings, and attachments (PDF/DOC/SHEET/IMAGE/AUDIO).
- **Entitlement**: An APPROVED enrollment granting a learner access to a Group's content.

## Requirements

### Requirement 1: Signed, short-lived playback tickets

**User Story:** As the system, I want to issue short-lived signed playback tickets only to entitled viewers, so that media URLs cannot be shared or reused.

#### Acceptance Criteria

1. WHEN an entitled client requests playback for an asset/lesson, THE API SHALL issue a Playback_Ticket containing a short-lived signed manifest reference, DRM license endpoints, watermark identity, an expiry timestamp, and the Group's `downloadAllowed` flag.
2. IF the requester lacks an APPROVED Entitlement for the Group, THEN THE API SHALL deny the ticket with an authorization error and SHALL NOT return any media URL.
3. THE API SHALL set ticket/manifest lifetimes to a short configurable window and SHALL require re-authorization after expiry.
4. THE API SHALL NOT return permanent, directly addressable media file URLs to the client at any point.

### Requirement 2: Multi-DRM license brokering

**User Story:** As the system, I want to broker DRM license requests server-side, so that vendor keys never reach the browser and only entitled sessions get keys.

#### Acceptance Criteria

1. THE API SHALL expose a License_Proxy that forwards EME license challenges to the DRM_Provider for Widevine, FairPlay, and PlayReady.
2. THE License_Proxy SHALL hold all DRM_Provider credentials/keys server-side and SHALL NOT expose them to the client.
3. WHEN a license challenge arrives, THE API SHALL verify the caller's Entitlement and unexpired ticket before forwarding to the DRM_Provider.
4. IF entitlement or ticket validation fails, THEN THE License_Proxy SHALL refuse to return a license.
5. THE API SHALL produce DRM-encrypted adaptive streams (or delegate encryption to the DRM_Provider) so that delivered media is not a raw decryptable file.

### Requirement 3: Per-viewer forensic watermark identity

**User Story:** As an Instructor, I want each viewing session bound to a learner identity, so that a leaked recording can be traced to who leaked it.

#### Acceptance Criteria

1. WHEN issuing a Playback_Ticket, THE API SHALL derive a Forensic_Watermark_Identity from the authenticated session (e.g. masked email/user id/enrollment id), not from client input.
2. WHERE the DRM_Provider supports session-bound/forensic watermarking, THE API SHALL pass the viewer identity needed to bind the stream to the session.
3. THE API SHALL provide the watermark label text for the client overlay as part of the ticket.
4. THE API SHALL apply watermark identity to both recorded lessons and live-session recordings.

### Requirement 4: Hardened, gated file streaming

**User Story:** As an Instructor, I want student access to files governed by my Download_Permission, so that restricted files cannot be downloaded or extracted from the page.

#### Acceptance Criteria

1. THE API SHALL stream Protected_Content files through an authorized endpoint that requires a valid Entitlement, rather than returning the underlying signed storage URL.
2. WHILE Download_Permission is disabled for a Group, THE API SHALL serve restricted files with `Content-Disposition: inline` and SHALL NOT provide an attachment/download response for learners.
3. WHEN Download_Permission is enabled, THE API SHALL allow an authorized streamed download (`Content-Disposition: attachment`) for entitled learners.
4. THE API SHALL enforce Download_Permission and Entitlement server-side on every file request, independent of any client-provided flag.
5. THE API SHALL expose `downloadAllowed` as a server-authoritative field on Group/lesson DTOs for display purposes.

### Requirement 5: Live recording finalization to protected lessons

**User Story:** As a Learner, I want a finished live class to become an on-demand protected recording, so that I can rewatch it securely.

#### Acceptance Criteria

1. WHEN a LiveSession ends, THE API SHALL finalize its recording into a MediaAsset associated with the lesson and SHALL transition the session to ENDED or RECORDING_FAILED.
2. THE API SHALL make the finalized recording playable only through the Playback_Ticket + License_Proxy path (Requirements 1–3).
3. IF recording finalization fails, THEN THE API SHALL set RECORDING_FAILED and surface a status the frontend can display.

### Requirement 6: Leak detection & response support

**User Story:** As an Admin, I want logging and tooling to support leak investigation and takedowns, so that traceability is actionable.

#### Acceptance Criteria

1. THE API SHALL log playback sessions with the viewer identity, asset, and timestamp sufficient to correlate a watermark to a session.
2. THE API SHALL retain session/watermark mapping for a configurable retention period.
3. WHERE the DRM_Provider exposes concurrency/anomaly signals, THE API SHALL ingest or expose them to support detection.
4. THE API SHALL provide admins a way to look up which learner identity corresponds to a watermark/session marker.

### Requirement 7: Configuration, secrets, and graceful fallback

**User Story:** As an operator, I want DRM configuration handled securely with safe degradation, so that the platform stays operational during setup or provider issues.

#### Acceptance Criteria

1. THE API SHALL read DRM_Provider credentials and protection settings from secure server configuration/secrets, never from client-exposed config.
2. WHERE the DRM_Provider is not yet configured, THE API SHALL operate against a clearly-flagged development fallback (e.g. the existing proxy) WITHOUT presenting it as production-grade protection.
3. IF the DRM_Provider is unavailable at request time, THEN THE API SHALL fail closed for protected playback (no unprotected fallback in production) and return an actionable error.
4. THE API SHALL keep protection settings (ticket lifetime, retention, watermark format) configurable without code changes.

## Open Questions / Clarifications Needed

1. **Provider selection** (shared with `frontend-redesign` OQ1): VdoCipher vs Gumlet vs Mux vs self-hosted multi-DRM — determines license API shape, watermark capability, and cost.
2. **FairPlay certificate** provisioning for Safari/iOS web (Apple developer assets).
3. **Encryption ownership:** does the provider encrypt/transcode (preferred) or must `Media_Service` perform packaging/encryption?
4. **Watermark type:** visible overlay only (client) vs provider forensic (session-bound) vs both.
5. **Retention period** for session/watermark mapping (privacy vs investigation needs).
6. **Existing assets:** do already-uploaded lesson videos get re-packaged/encrypted, or only new uploads?
7. **Live recording protection:** does the live stack (mediasoup) output feed the DRM_Provider for packaging, and how is the recording encrypted at rest?
