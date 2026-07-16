import Link from 'next/link';

/**
 * LandingFooter — comprehensive footer with all links and brand.
 */
export function LandingFooter({ locale }: { locale: string }) {
  return (
    <footer className="relative border-t border-white/[0.07] bg-ink">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4">
            <Link
              href={`/${locale}`}
              className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-cream"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent2-500 text-ink"
                style={{ boxShadow: '0 0 24px rgba(0,232,122,0.5)' }}
              >
                <Logo />
              </span>
              Bilgim
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream-dim">
              O&apos;zbekiston uchun zamonaviy onlayn ta&apos;lim platformasi.
              O&apos;qituvchilar va talabalarni bog&apos;laydigan AI-yordamchili
              tizim.
            </p>

            {/* Social */}
            <div className="mt-6 flex gap-2">
              <SocialLink href="https://t.me/bilgim_uz" label="Telegram">
                <TelegramIcon />
              </SocialLink>
              <SocialLink href="#" label="Instagram">
                <InstagramIcon />
              </SocialLink>
              <SocialLink href="#" label="YouTube">
                <YouTubeIcon />
              </SocialLink>
              <SocialLink href="#" label="LinkedIn">
                <LinkedInIcon />
              </SocialLink>
            </div>

            {/* Trust badges */}
            <div className="mt-8 space-y-2 text-xs">
              <p className="flex items-center gap-2 text-cream-dim">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent2-500/10 text-accent2-500">
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
                O&apos;zbekiston PDP qonuniga mos
              </p>
              <p className="flex items-center gap-2 text-cream-dim">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent2-500/10 text-accent2-500">
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
                AES-256 shifrlash · TLS 1.3
              </p>
            </div>
          </div>

          {/* Spacer */}
          <div className="hidden md:col-span-1 md:block" />

          {/* Product */}
          <FooterColumn
            title="Mahsulot"
            links={[
              { label: 'Imkoniyatlar', href: '#features' },
              { label: 'AI Tutor', href: '#ai-tutor' },
              { label: 'Narxlar', href: '#pricing' },
              { label: 'Mobil ilova', href: `/${locale}/mobile` },
            ]}
          />

          {/* For users */}
          <FooterColumn
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

          {/* Company */}
          <FooterColumn
            title="Kompaniya"
            links={[
              { label: 'Biz haqimizda', href: `/${locale}/about` },
              { label: 'Karyera', href: `/${locale}/careers` },
              { label: 'Blog', href: `/${locale}/blog` },
              { label: 'Yangiliklar', href: `/${locale}/news` },
            ]}
          />

          {/* Legal */}
          <FooterColumn
            title="Yuridik"
            links={[
              {
                label: 'Maxfiylik siyosati',
                href: `/${locale}/legal/privacy`,
              },
              {
                label: 'Foydalanish shartlari',
                href: `/${locale}/legal/terms`,
              },
              {
                label: "PDP ma'lumotlari",
                href: `/${locale}/legal/pdp`,
              },
              { label: 'Qo&apos;llab-quvvatlash', href: `/${locale}/support` },
            ]}
          />
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/[0.07] pt-8 sm:flex-row">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim/60">
            © {new Date().getFullYear()} Bilgim. Barcha huquqlar
            himoyalangan.
          </p>
          <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim/60">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
              Tashkent · Toshkent
            </span>
            <span>·</span>
            <span>Made with passion in Uzbekistan 🇺🇿</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="md:col-span-2">
      <h4 className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-cream/80">
        {title}
      </h4>
      <ul className="mt-4 space-y-3 text-sm text-cream-dim">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="transition-colors hover:text-cream"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialLink({
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
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-cream-dim transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
    >
      {children}
    </a>
  );
}

function Logo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function InstagramIcon() {
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

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
