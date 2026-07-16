import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../lib/server-auth';
import { AiPromptsTable } from '../../../../../components/admin/tables/ai-prompts-table';

interface AdminAiPromptsTablePageProps {
  params: { locale: string };
}

/**
 * Admin AI prompt templates management table (task 13.2, Req 17.2/17.3).
 *
 * Server component: enforces ADMIN access, then renders the `AiPromptsTable`
 * (sort / filter / paginate + confirm-destructive delete). Create / full edit
 * lives on the `/admin/ai` editor surface.
 */
export default function AdminAiPromptsTablePage({
  params: { locale },
}: AdminAiPromptsTablePageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          AI promptlar
        </h1>
        <p className="mt-1.5 text-ink-soft">
          AI prompt shablonlarini ko&apos;rish va boshqarish.
        </p>
      </header>

      <AiPromptsTable />
    </div>
  );
}
