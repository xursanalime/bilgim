/**
 * /api/media/proxy — R2 URL larini to'liq yashiradi.
 *
 * URL turlari:
 *   ?assetId=<uuid>                          → master manifest (rewritten)
 *   ?assetId=<uuid>&variant=<name>           → variant playlist (rewritten segments)
 *   ?assetId=<uuid>&seg=<variant>/<filename> → .ts segment stream
 *   ?assetId=<uuid>                          → rasm/audio/pdf (non-video)
 *
 * Himoya:
 *  - JWT cookie tekshiruvi (server-side, brauzerda ko'rinmaydi)
 *  - Content-Disposition: inline (yuklab olib bo'lmaydi)
 *  - Cache-Control: no-store (brauzer saqlay olmaydi)
 *  - Barcha R2 URL lar faqat server da yashaydi
 */

import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Web app JavaScript cookie (HttpOnly bo'lmagan, lekin faqat shu mavjud)
const TOKEN_COOKIES = ['bilgim_access_token', 'access_token'];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Segment path: faqat xavfsiz belgilar (path traversal oldini olish)
const SAFE_SEG_RE = /^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/;

function getToken(req: NextRequest): string | undefined {
  for (const name of TOKEN_COOKIES) {
    const val = req.cookies.get(name)?.value;
    if (val) return val;
  }
  return undefined;
}

function secureHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    Pragma: 'no-cache',
  };
}

async function apiFetch(path: string, token: string) {
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
}

export async function GET(req: NextRequest) {
  // ─── Auth ───────────────────────────────────────────────────────────────
  const token = getToken(req);
  if (!token) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams, origin } = req.nextUrl;

  // ─── assetId tekshiruvi ─────────────────────────────────────────────────
  const assetId = searchParams.get('assetId') ?? '';
  if (!UUID_RE.test(assetId)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const variantParam = searchParams.get('variant'); // e.g. "720p"
  const segParam = searchParams.get('seg');         // e.g. "720p/segment001.ts"

  try {
    // ─── HLS SEGMENT so'rovi ──────────────────────────────────────────────
    // .ts segment URL lar proxy orqali o'tadi → R2 URL brauzerda ko'rinmaydi
    if (segParam) {
      if (!SAFE_SEG_RE.test(segParam)) {
        return new NextResponse('Bad Request', { status: 400 });
      }

      // NestJS API dan segment uchun imzolangan URL olish
      const segRes = await apiFetch(
        `/api/v1/media/assets/${assetId}/hls-segment?seg=${encodeURIComponent(segParam)}`,
        token,
      );
      if (!segRes.ok) {
        return new NextResponse('Forbidden', { status: segRes.status === 403 ? 403 : 502 });
      }
      const { url: segUrl } = (await segRes.json()) as { url: string };

      const r2Seg = await fetch(segUrl, { cache: 'no-store' });
      if (!r2Seg.ok) return new NextResponse('Upstream error', { status: 502 });

      return new NextResponse(r2Seg.body, {
        headers: secureHeaders('video/MP2T'),
      });
    }

    // ─── HLS VARIANT PLAYLIST so'rovi ────────────────────────────────────
    if (variantParam) {
      // API dan barcha URL larni olamiz
      const apiRes = await apiFetch(
        `/api/v1/media/assets/${assetId}/url?expiresIn=300`,
        token,
      );
      if (!apiRes.ok) {
        return new NextResponse('Forbidden', { status: apiRes.status });
      }
      const playback = (await apiRes.json()) as {
        urls?: Array<{ role: string; url: string; variant?: string }>;
      };

      const variantEntry = playback.urls?.find(
        (u) => u.role === 'variant' && u.variant === variantParam,
      );
      if (!variantEntry) {
        return new NextResponse('Variant not found', { status: 404 });
      }

      const vRes = await fetch(variantEntry.url, { cache: 'no-store' });
      if (!vRes.ok) return new NextResponse('Upstream error', { status: 502 });

      const playlistText = await vRes.text();
      // Segment URL larini proxy orqali yo'naltirish
      const rewritten = rewriteVariantPlaylist(
        playlistText,
        assetId,
        variantParam,
        origin,
      );

      return new NextResponse(rewritten, {
        headers: secureHeaders('application/vnd.apple.mpegurl'),
      });
    }

    // ─── MASTER MANIFEST yoki oddiy fayl ─────────────────────────────────
    const apiRes = await apiFetch(
      `/api/v1/media/assets/${assetId}/url?expiresIn=300`,
      token,
    );
    if (!apiRes.ok) {
      const status = apiRes.status === 403 ? 403 : apiRes.status === 404 ? 404 : 502;
      return new NextResponse('Media unavailable', { status });
    }

    const playback = (await apiRes.json()) as {
      url: string;
      type: 'manifest' | 'variant' | 'original';
      kind: string;
    };

    // Forward the browser's Range header so progressive media (video/audio)
    // can be SEEKED. Without this the upstream returns a full 200 body with no
    // Accept-Ranges, and the <video> element jumps back to the start whenever
    // the user seeks (the "video boshiga qaytib qolyapdi" bug).
    const range = req.headers.get('range') ?? undefined;
    const r2Res = await fetch(playback.url, {
      cache: 'no-store',
      ...(range ? { headers: { Range: range } } : {}),
    });
    if (!r2Res.ok) return new NextResponse('Upstream error', { status: 502 });

    const contentType =
      r2Res.headers.get('content-type') ?? 'application/octet-stream';

    // HLS manifest — variant URL larini proxy orqali yo'naltirish
    if (
      playback.type === 'manifest' ||
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegurl')
    ) {
      const manifestText = await r2Res.text();
      const rewritten = rewriteMasterManifest(manifestText, assetId, origin);
      return new NextResponse(rewritten, {
        headers: secureHeaders('application/vnd.apple.mpegurl'),
      });
    }

    // Rasm, audio, PDF, progressive video — stream orqali qaytarish.
    // Range so'rovini qo'llab-quvvatlaymiz: upstream statusini (200/206) va
    // range sarlavhalarini (Content-Range, Accept-Ranges, Content-Length)
    // o'tkazamiz, shunda pleyer videoni oldinga/orqaga o'tkaza oladi.
    const mediaHeaders = secureHeaders(contentType);
    mediaHeaders['Accept-Ranges'] =
      r2Res.headers.get('accept-ranges') ?? 'bytes';
    const contentRange = r2Res.headers.get('content-range');
    if (contentRange) mediaHeaders['Content-Range'] = contentRange;
    const contentLength = r2Res.headers.get('content-length');
    if (contentLength) mediaHeaders['Content-Length'] = contentLength;
    return new NextResponse(r2Res.body, {
      status: r2Res.status === 206 ? 206 : 200,
      headers: mediaHeaders,
    });
  } catch {
    return new NextResponse('Internal error', { status: 500 });
  }
}

/**
 * Master manifest ichidagi variant `.m3u8` URL larini proxy URL ga o'zgartiradi.
 * Masalan: `720p/playlist.m3u8` → `/api/media/proxy?assetId=xxx&variant=720p`
 */
function rewriteMasterManifest(
  manifest: string,
  assetId: string,
  origin: string,
): string {
  return manifest
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      // Variant playlist satrlari (*.m3u8 bilan tugaydi)
      if (trimmed.endsWith('.m3u8')) {
        // "720p/playlist.m3u8" → "720p"
        const variantMatch = trimmed.match(/([^/]+)\/[^/]+\.m3u8$/);
        // Oddiy "720p.m3u8" → "720p"
        const simpleMatch = trimmed.match(/([^/]+)\.m3u8$/);
        const variantName =
          variantMatch?.[1] ?? simpleMatch?.[1] ?? 'default';
        return `${origin}/api/media/proxy?assetId=${assetId}&variant=${encodeURIComponent(variantName)}`;
      }
      return line;
    })
    .join('\n');
}

/**
 * Variant playlist ichidagi segment URL larini proxy URL ga o'zgartiradi.
 * Masalan: `segment001.ts` → `/api/media/proxy?assetId=xxx&seg=720p%2Fsegment001.ts`
 */
function rewriteVariantPlaylist(
  playlist: string,
  assetId: string,
  variantName: string,
  origin: string,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      // Segment fayllari (.ts, .aac, .mp4 kabi)
      if (/\.(ts|aac|mp4|m4s|fmp4)$/i.test(trimmed)) {
        // Faqat fayl nomini olish (relative path support)
        const filename = trimmed.split('/').pop() ?? trimmed;
        const segPath = `${variantName}/${filename}`;
        return `${origin}/api/media/proxy?assetId=${assetId}&seg=${encodeURIComponent(segPath)}`;
      }
      return line;
    })
    .join('\n');
}
