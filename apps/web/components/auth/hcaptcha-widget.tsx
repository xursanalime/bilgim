'use client';

import { useRef } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';

const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY;

interface HCaptchaWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  id?: string;
}

/**
 * Real hCaptcha challenge — replaces the old client-only MathCaptcha
 * (which never sent anything to the server, so it stopped nothing).
 *
 * Only rendered when the backend's adaptive bot-detection guard has
 * actually flagged the request as CHALLENGE (403 `CAPTCHA_REQUIRED`) —
 * see login-form.tsx / register-form.tsx. Most users never see this at
 * all, matching the backend's progressive-challenge design.
 *
 * If `NEXT_PUBLIC_HCAPTCHA_SITEKEY` isn't configured (e.g. local dev
 * where `HCAPTCHA_SECRET` is also unset server-side, so the backend
 * never actually demands a solution), this renders a inert notice
 * instead of a broken widget.
 */
export function HCaptchaWidget({ onVerify, onExpire, id }: HCaptchaWidgetProps) {
  const ref = useRef<HCaptcha>(null);

  if (!SITE_KEY) {
    return (
      <p className="rounded-2xl border border-orange/30 bg-orange-tint p-3 text-xs text-orange">
        Captcha sozlanmagan (NEXT_PUBLIC_HCAPTCHA_SITEKEY yo&apos;q) — administrator
        bilan bog&apos;laning.
      </p>
    );
  }

  return (
    <div id={id} className="flex justify-center">
      <HCaptcha
        ref={ref}
        sitekey={SITE_KEY}
        onVerify={onVerify}
        onExpire={() => {
          ref.current?.resetCaptcha();
          onExpire?.();
        }}
      />
    </div>
  );
}
