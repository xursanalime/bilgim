import { unstable_setRequestLocale } from 'next-intl/server';
import { Header } from '../../components/landing/header';
import { Hero } from '../../components/landing/hero';
import { LogosStrip } from '../../components/landing/logos-strip';
import { Stats } from '../../components/landing/stats';
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
import { discoveryApi } from '../../lib/api/discovery';

interface Props {
  params: { locale: string };
}

export default async function LandingPage({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);

  // Fetch marketing content for non-code configuration
  let cmsData = null;
  try {
    cmsData = await discoveryApi.getSetting('MARKETING_CONTENT');
  } catch (e) {
    // Fallback to defaults
  }

  return (
    <div style={{ backgroundColor: '#F5F5F7' }}>
      {/* Cursor-follow halo */}
      <CursorSpotlight />

      <Header locale={locale} />
      <main>
        <Hero 
          locale={locale} 
          title={cmsData?.heroTitleUz} 
          subtitle={cmsData?.heroSubtitleUz} 
        />
        <LogosStrip />
        <Stats />
        <FeaturesBento />
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
        text={cmsData?.footerTextUz}
      />
    </div>
  );
}
