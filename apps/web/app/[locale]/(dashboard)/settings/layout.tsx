import { unstable_setRequestLocale } from 'next-intl/server';
import { SettingsLayoutClient } from '../../../../components/settings/settings-layout';

interface SettingsLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default function SettingsLayout({
  children,
  params: { locale },
}: SettingsLayoutProps) {
  unstable_setRequestLocale(locale);

  return (
    <div className="mx-auto max-w-7xl pb-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
          Sozlamalar
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Shaxsiy profilingiz, xavfsizlik va platforma sozlamalarini boshqaring.
        </p>
      </header>
      
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <SettingsLayoutClient locale={locale} />
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
