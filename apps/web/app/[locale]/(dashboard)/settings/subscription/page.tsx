import { unstable_setRequestLocale } from 'next-intl/server';

import { SubscriptionPanel } from '../../../../../components/billing/subscription-panel';

interface SubscriptionPageProps {
  params: { locale: string };
}

export default function SettingsSubscriptionPage({
  params: { locale },
}: SubscriptionPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="space-y-2">
        <h2 className="font-display text-2xl font-extrabold text-ink-strong sm:text-3xl">
          Obuna
        </h2>
        <p className="max-w-md text-sm text-ink-soft">
          Obuna holatingizni kuzating va tarifni boshqaring. To‘lovlar Payme
          orqali amalga oshiriladi.
        </p>
      </header>

      <SubscriptionPanel locale={locale} />
    </div>
  );
}
