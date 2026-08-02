import { redirect } from 'next/navigation';

interface AssignmentDetailPageProps {
  params: { locale: string; id: string };
}

/** Legacy alias for `/[locale]/homework/[assignmentId]`. See `../page.tsx`. */
export default function AssignmentDetailRedirect({
  params: { locale, id },
}: AssignmentDetailPageProps) {
  redirect(`/${locale}/homework/${id}`);
}
