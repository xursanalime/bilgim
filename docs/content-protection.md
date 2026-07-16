# Content protection — honest limitation

> Scope: web (`apps/web`). Companion to `.kiro/specs/frontend-redesign/`
> (Requirements 1.6 and 4.4) and `.kiro/specs/content-protection-backend/`.

## The honest limitation (recorded up front)

**Complete prevention of screenshots and screen recording on the web is not
technically achievable.** Industry research (VdoCipher, Dolby/THEO, Gumlet,
W3C EME) confirms there is no browser API that fully blocks screen capture, and
an external camera pointed at the screen defeats any software control. Bilgim
therefore treats content protection as a **layered defence whose goal is to make
piracy impractical and traceable — never "100% impossible."**

We must not market or imply absolute prevention anywhere in the product. UI copy
leans on **traceability and accountability**, not on a promise that capture is
blocked.

## What the protection does (web)

- **Encryption + DRM** — protected video plays only through DRM-encrypted
  adaptive streams (multi-DRM via EME), never from a raw downloadable file URL.
- **Access control** — short-lived, expiring signed URLs / playback tokens, and
  playback is granted only to learners with an APPROVED enrollment.
- **Per-viewer forensic watermark** — each learner's session carries a
  server-derived, PII-masked identifier overlaid on the video, so a leaked copy
  is traceable to a specific viewer.
- **Fail-closed playback** — if DRM cannot initialise, the player refuses to play
  rather than falling back to an unprotected source.
- **Best-effort deterrence** — disabled right-click/drag-save, pause-and-obscure
  on focus/visibility loss, and best-effort screen-share detection.

## What the protection cannot guarantee

- **Web screenshots / screen recording cannot be fully prevented.** Hardware DRM
  yields a black frame on *some* OS/browser combinations (≈70–80% on Windows),
  but Chrome on macOS/Linux exposes no native capture-blocking mechanism.
- **An external camera filming the screen is not technically preventable** by any
  software. The watermark makes such a leak traceable, not impossible.
- **Native mobile is stronger than web.** The mobile app (`apps/mobile`) can
  enforce OS-level protection (Android `FLAG_SECURE`, iOS screen-capture
  detection) that the web cannot. For the highest-value content, recommend the
  app.

## Where this is surfaced in the product

- **Learners** see a calm "protected & traceable" notice near protected media —
  `apps/web/components/protection/protected-content-notice.tsx`
  (`ProtectedContentNotice`). It states the content is protected and the session
  is watermarked and traceable, without claiming capture is impossible (Req 1.6,
  4.4).
- **Instructors** get an honest expectations explainer —
  `apps/web/components/protection/capture-limits-explainer.tsx`
  (`CaptureLimitsExplainer`) — describing what the protection does and does not
  do on the web (Req 4.4).
