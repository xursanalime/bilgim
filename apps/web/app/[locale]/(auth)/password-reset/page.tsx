import { redirect } from 'next/navigation';

interface PasswordResetPageProps {
  params: { locale: string };
  searchParams: { token?: string };
}

/**
 * Legacy `/password-reset` alias — redirects to either the request page
 * (`/forgot-password`) when no token is present, or the confirm page
 * (`/reset-password?token=...`) when arriving from the email link.
 */
export default function PasswordResetPage({
  params: { locale },
  searchParams,
}: PasswordResetPageProps) {
  if (searchParams.token) {
    redirect(`/${locale}/reset-password?token=${searchParams.token}`);
  }
  redirect(`/${locale}/forgot-password`);
}
