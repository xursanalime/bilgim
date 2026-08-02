import { redirect } from 'next/navigation';

interface SignupPageProps {
  params: { locale: string };
  searchParams: { role?: string };
}

/**
 * Legacy `/signup` alias — redirects to `/register` while preserving any
 * `?role=` hint coming from marketing CTAs.
 */
export default function SignupPage({
  params: { locale },
  searchParams,
}: SignupPageProps) {
  const query = searchParams.role ? `?role=${searchParams.role}` : '';
  redirect(`/${locale}/register${query}`);
}
