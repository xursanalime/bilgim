import Link from 'next/link';
import { BrandMark } from './brand-logo';

export function Footer({ locale, text }: { locale: string; text?: string }) {
  return (
    <footer className="relative border-t border-rim bg-canvas">
      <div className="container-page py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-4">
            <Link
              href={`/${locale}`}
              className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-ink-strong"
              style={{ letterSpacing: '-0.025em' }}
            >
              <BrandMark size={36} />
              Bilgim
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-soft">
              {text || (
                <>
                  O&apos;zbekiston uchun zamonaviy onlayn ingliz tili platformasi.
                  O&apos;qituvchi va talabani bog&apos;lovchi AI-yordamchili tizim.
                </>
              )}
            </p>
            <div className="mt-6 flex gap-2">
              <Social href="https://t.me/edubridge_uz" label="Telegram">
                <Telegram />
              </Social>
              <Social href="#" label="Instagram">
                <Instagram />
              </Social>
              <Social href="#" label="YouTube">
                <YouTube />
              </Social>
              <Social href="#" label="LinkedIn">
                <LinkedIn />
              </Social>
            </div>
            {/* Trust */}
            <div className="mt-8 space-y-2 text-xs">
              <p className="flex items-center gap-2 text-ink-soft">
                <Shield />
                AES-256 shifrlash · TLS 1.3
              </p>
              <p className="flex items-center gap-2 text-ink-soft">
                <Shield />
                O&apos;zbekiston PDP qonuniga mos
              </p>
            </div>
          </div>

          <div className="hidden md:col-span-1 md:block" />

          <Column
            title="Mahsulot"
            links={[
              { label: 'Imkoniyatlar', href: '#features' },
              { label: 'AI Tutor', href: '#ai' },
              { label: 'Tariflar', href: '#pricing' },
              { label: 'Mobil ilova', href: `/${locale}/mobile` },
            ]}
          />
          <Column
            title="Foydalanuvchilar"
            links={[
              {
                label: "O'qituvchilar uchun",
                href: `/${locale}/register?role=teacher`,
              },
              {
                label: 'Talabalar uchun',
                href: `/${locale}/talabalar-uchun`,
              },
              {
                label: "O'qituvchini topish",
                href: `/${locale}/search`,
              },
              { label: 'Kurslar', href: `/${locale}/courses` },
            ]}
          />
          <Column
            title="Kompaniya"
            links={[
              { label: 'Biz haqimizda', href: `/${locale}/about` },
              { label: 'Karyera', href: `/${locale}/careers` },
              { label: 'Blog', href: `/${locale}/blog` },
              { label: 'Yangiliklar', href: `/${locale}/news` },
            ]}
          />
          <Column
            title="Yuridik"
            links={[
              { label: 'Maxfiylik', href: `/${locale}/legal/privacy` },
              { label: 'Foydalanish', href: `/${locale}/legal/terms` },
              { label: 'PDP', href: `/${locale}/legal/pdp` },
              { label: 'Yordam', href: `/${locale}/support` },
            ]}
          />
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-rim pt-8 sm:flex-row">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/60">
            © {new Date().getFullYear()} Bilgim. Barcha huquqlar himoyalangan.
          </p>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/60">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" />
              Tashkent · Toshkent
            </span>
            <span>·</span>
            <span>Made in Uzbekistan</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function Column({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="md:col-span-2">
      <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-strong/80">
        {title}
      </h4>
      <ul className="mt-4 space-y-3 text-sm text-ink-soft">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="transition-colors hover:text-ink-strong"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Social({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-rim bg-canvas text-ink-soft transition-all hover:border-blue/40 hover:bg-blue/10 hover:text-blue"
    >
      {children}
    </a>
  );
}

function Logo() {
  // Legacy: kept for backwards-compat references but no longer used.
  return null;
}

function Shield() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal/15 text-teal">
      <svg
        className="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function Telegram() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
function Instagram() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
function YouTube() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
function LinkedIn() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
