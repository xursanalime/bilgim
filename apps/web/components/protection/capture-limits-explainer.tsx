'use client';

import { useId, useState, type HTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// CaptureLimitsExplainer — instructor-facing honest explainer (Req 4.4, 1.6).
//
// A short, collapsible panel that sets correct expectations for Instructors
// about what Bilgim's content protection DOES and does NOT do on the web. It is
// deliberately honest (per the recorded limitation): complete prevention of
// screenshots / screen recording on the web is NOT technically possible. The
// platform makes piracy impractical and, crucially, TRACEABLE — it does not
// promise absolute prevention.
//
// Implemented as an accessible disclosure (button + region) with
// `aria-expanded` / `aria-controls`. No external accordion dependency. The only
// state change is show/hide; there is no animation to gate behind
// `prefers-reduced-motion`.
// ═════════════════════════════════════════════════════════════════

const HEADING_UZ = "Web’da kontent himoyasi: imkoniyatlar va cheklovlar";
const SUMMARY_UZ =
  "Himoya nusxa ko‘chirishni qiyinlashtiradi va har qanday tarqalishni kuzatish imkonini beradi, " +
  "lekin web brauzerda ekrandan yozib olishni to‘liq to‘xtatib bo‘lmaydi. Quyida nima ishlashini ko‘ring.";

const DOES_TITLE_UZ = 'Himoya nima qiladi';
const DOES_ITEMS_UZ: readonly string[] = [
  'Video shifrlanadi va faqat qisqa muddatli, muddati tugaydigan havolalar orqali ijro etiladi.',
  'Faqat tasdiqlangan o‘quvchilar kirishi mumkin (kirish nazorati va ruxsat tekshiruvi).',
  'Har bir o‘quvchi uchun shaxsiy suvli belgi qo‘yiladi — tarqalgan nusxa kimligini aniqlaydi.',
  'DRM ishlamasa, ijro himoyasiz holatga tushmaydi (xavfsiz to‘xtaydi).',
];

const DOESNT_TITLE_UZ = 'Himoya nimani kafolatlay olmaydi';
const DOESNT_ITEMS_UZ: readonly string[] = [
  'Web brauzerda skrinshot yoki ekran yozuvini to‘liq to‘xtatib bo‘lmaydi.',
  'Tashqi kamera bilan ekranni suratga olishni hech qanday dastur to‘xtata olmaydi.',
  'Mobil ilova (Android FLAG_SECURE, iOS aniqlash) web’ga qaraganda kuchliroq himoya beradi.',
];

const CONCLUSION_UZ =
  "Shu sababli himoyaning maqsadi — nusxa ko‘chirishni amaliy jihatdan foydasiz va kuzatib " +
  "boriladigan qilish; mutlaq himoyani va’da berish emas.";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface CaptureLimitsExplainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Whether the panel starts expanded. Defaults to `false`. */
  defaultOpen?: boolean;
}

export function CaptureLimitsExplainer({
  defaultOpen = false,
  className,
  ...props
}: CaptureLimitsExplainerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div
      className={cn('rounded-2xl border border-rim bg-canvas shadow-soft', className)}
      {...props}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-ink-strong">{HEADING_UZ}</span>
        <ChevronIcon open={open} />
      </button>

      <div id={regionId} role="region" aria-label={HEADING_UZ} hidden={!open} className="px-4 pb-4">
        <p className="text-xs leading-relaxed text-ink-soft">{SUMMARY_UZ}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <section>
            <h4 className="text-xs font-semibold text-green">{DOES_TITLE_UZ}</h4>
            <ul className="mt-2 space-y-1.5">
              {DOES_ITEMS_UZ.map((item) => (
                <li key={item} className="text-xs leading-relaxed text-ink-soft">
                  • {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="text-xs font-semibold text-orange">{DOESNT_TITLE_UZ}</h4>
            <ul className="mt-2 space-y-1.5">
              {DOESNT_ITEMS_UZ.map((item) => (
                <li key={item} className="text-xs leading-relaxed text-ink-soft">
                  • {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-soft">{CONCLUSION_UZ}</p>
      </div>
    </div>
  );
}

export default CaptureLimitsExplainer;
