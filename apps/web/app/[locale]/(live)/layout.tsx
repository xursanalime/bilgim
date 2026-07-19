import type { ReactNode } from 'react';
import { QueryProvider } from '../../../components/providers/query-provider';

export default function LiveLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      {children}
    </QueryProvider>
  );
}
