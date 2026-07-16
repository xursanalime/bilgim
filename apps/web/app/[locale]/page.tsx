import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { Header } from '../../components/landing/header';
import { Hero } from '../../components/landing/hero';
import { LogosStrip } from '../../components/landing/logos-strip';
import { FeaturesBento } from '../../components/landing/features-bento';
import { LiveShowcase } from '../../components/landing/live-showcase';
import { Specialties } from '../../components/landing/specialties';
import { AiSection } from '../../components/landing/ai-section';
import { ForRoles } from '../../components/landing/for-roles';
import { Pricing } from '../../components/landing/pricing';
import { Testimonials } from '../../components/landing/testimonials';
import { Faq } from '../../components/landing/faq';
import { FinalCta } from '../../components/landing/final-cta';
import { Footer } from '../../components/landing/footer';
import { CursorSpotlight } from '../../components/landing/cursor-spotlight';
import { FeatureShowcase } from '../../components/landing/feature-showcase';
import { discoveryApi } from '../../lib/api/discovery';

interface Props {
  params: { locale: string };
}

export function generateMetadata({ params: { locale } }: Props): Metadata {
  const title = "Bilgim — Ingliz tili o'qituvchilari uchun platforma";
  const description =
    "Kurs yarating, jonli efir o'ting, AI yordamchi bilan o'rganing — bir tizimda. " +
    '14 kun bepul, karta kerak emas.';

  return {
    title,
    description,
    alternates: { canonical: `/${locale}` },
    openGraph: {
      title,
      description,
      type: 'website',
      locale,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function LandingPage({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);

  // Fetch marketing content for non-code configuration
  let cmsData = null;
  try {
    cmsData = await discoveryApi.getSetting<{
      heroTitleUz?: string;
      heroSubtitleUz?: string;
      footerTextUz?: string;
    }>('MARKETING_CONTENT');
  } catch (e) {
    // Fallback to defaults
  }

  return (
    <div className="bg-base">
      {/* Cursor-follow halo */}
      <CursorSpotlight />

      <Header locale={locale} />
      <main id="main-content" tabIndex={-1}>
        <Hero
          locale={locale}
          {...(cmsData?.heroTitleUz ? { title: cmsData.heroTitleUz } : {})}
          {...(cmsData?.heroSubtitleUz
            ? { subtitle: cmsData.heroSubtitleUz }
            : {})}
        />
        <LogosStrip />
        <FeaturesBento />
        <FeatureShowcase locale={locale} />
        <LiveShowcase />
        <Specialties />
        <AiSection />
        <ForRoles locale={locale} />
        <Pricing locale={locale} />
        <Testimonials />
        <Faq />
        <FinalCta locale={locale} />
      </main>
      <Footer
        locale={locale}
        {...(cmsData?.footerTextUz ? { text: cmsData.footerTextUz } : {})}
      />
    </div>
  );
}
