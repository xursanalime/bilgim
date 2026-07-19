import type { ReactNode } from 'react';

/**
 * Auth route group layout — full-screen, no marketing header/footer.
 * Each auth page renders its own AuthLayout (split brand panel).
 */
export default function AuthRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
