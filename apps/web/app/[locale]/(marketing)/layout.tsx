import type { ReactNode } from 'react';
import { Header } from '../../../components/landing/header';
import { Footer } from '../../../components/landing/footer';

interface MarketingLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

/**
 * Marketing layout — Aurora light theme.
 *
 * Shares the same Liquid Glass header + comprehensive footer with the
 * root landing page so every marketing surface (/teachers, /courses,
 * /search, /pricing, /talabalar-uchun, /discover, /about ...) feels
 * like one coherent product.
 */
export default function MarketingLayout({
  children,
  params: { locale },
}: MarketingLayoutProps) {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: '#F5F5F7' }}
    >
      <Header locale={locale} />
      <main className="flex-1 pt-24">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}
