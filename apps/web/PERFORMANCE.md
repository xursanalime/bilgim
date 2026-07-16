# Web performance (apps/web)

Notes for the Core Web Vitals pass (frontend-redesign task 14.3, Requirement 20).
Scope of this pass: perf config + code-splitting + image optimization + font
preload + skeleton/optimistic affordances. Responsive (14.1), a11y (14.2), and
i18n (14.4) are tracked separately.

## Core Web Vitals budget

Targets are Google's "good" thresholds, measured at the 75th percentile on
mid-range devices for both authenticated and marketing pages (R20.1):

| Metric | Budget ("good") | Notes |
| ------ | --------------- | ----- |
| LCP (Largest Contentful Paint) | ≤ 2.5 s | Marketing hero + dashboard first card. |
| INP (Interaction to Next Paint) | ≤ 200 ms | Nav, dialogs, live controls. |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | Reserve space with skeletons / sized media. |
| TTFB | ≤ 0.8 s | Server-rendered routes. |

Supporting payload guidance:
- Keep per-route initial JS lean; heavy browser-only engines must be lazy.
- Ship modern image formats (AVIF/WebP) and never block paint on web fonts.

## What was done in this pass

### Perf config (`next.config.mjs`)
- `images.formats = ['image/avif', 'image/webp']` — modern formats negotiated
  per request with automatic fallback (R20.2).
- `images.minimumCacheTTL` — cache optimized variants for a day.
- `images.remotePatterns` — allow only the public, non-DRM image hosts the app
  actually uses (`avatars.githubusercontent.com`, `images.unsplash.com`).
  Protected lesson/live media is intentionally **not** served through
  `next/image`; it stays behind the media proxy per the CSP
  (`media-src 'self' blob:`). Optimized output is served from same-origin
  `/_next/image`, which the CSP `img-src 'self'` already covers.
- `experimental.optimizePackageImports` for `lucide-react` and `framer-motion`
  so only the icons/primitives actually used are bundled (smaller initial JS,
  R20.2).

### Code-splitting (`next/dynamic`, `ssr: false` + fallback)
- `components/live/live-session-join.tsx` — `LiveRoom` and `LiveViewer` were
  **already** lazy-loaded (LiveKit + tldraw runtime kept out of the route
  bundle). Confirmed, left as-is.
- `components/lesson/lesson-recordings.tsx` — `ProtectedVideoPlayer` (pulls in
  the Shaka/EME DRM runtime) is now lazy-loaded with `ssr: false` and an
  `aspect-video` skeleton fallback. It only mounts after a student presses play,
  so the DRM engine never ships with the lesson page.

### Image optimization (`next/image`)
- `components/landing/features-bento.tsx` — decorative Unsplash cover +
  thumbnail `<img>` converted to `next/image` with `fill` + `sizes`
  (AVIF/WebP + lazy-load + no layout shift).

### Font preload (`app/layout.tsx`)
- Fonts load via `next/font/google` (Inter, Syne, JetBrains Mono) with
  `display: 'swap'`. `next/font` self-hosts and **preloads** the font files by
  default and inlines the `@font-face` CSS, eliminating render-blocking font
  requests and layout shift. No external font CDN is used. (No ThemeProvider
  wiring was touched.)

### Skeletons / optimistic UI
- `components/ui/skeleton.tsx` primitive (pulse gated by
  `prefers-reduced-motion`) is reused for the lazy player fallback above.
- Higher-level loading/empty/error states live in `components/states/*` and are
  already wired into data-backed views (e.g. `lesson-recordings.tsx`).

## What remains for a full CWV pass

- **Field measurement**: wire a `web-vitals` reporter (or Vercel/Cloudflare
  Analytics) to capture real-user LCP/INP/CLS against the budget above. Add a CI
  Lighthouse budget check on the marketing + dashboard routes.
- **Remote avatars**: `<img>` avatars in `components/dashboard/*`,
  `components/messages/*`, and `components/homework/teacher-grading-queue.tsx`
  still use raw `<img>`. They were left untouched because their hosts are
  dynamic (R2-proxied / arbitrary) and not in `remotePatterns`; converting them
  needs the proxied avatar host(s) confirmed and added first.
- **`components/landing/live-showcase.tsx`** poster `<img>` is a video fallback
  behind an autoplaying `<video>`; converting to `next/image` needs care with
  the absolute-positioned layering and was deferred.
- **TipTap**: `components/teacher/lesson-form.tsx` is still a plain textarea
  (no editor mounted yet); when a real TipTap editor is added, mount it via
  `next/dynamic` with `ssr: false`.
- **Route-level RSC audit**: confirm marketing/dashboard pages keep client
  components at the leaves so server components stream the shell first.
- **LCP image priority**: once the marketing hero's LCP element is confirmed,
  set `priority` on that single `next/image` to preload it.
