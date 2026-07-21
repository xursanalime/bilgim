'use client';

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ApiClientError } from '../../lib/api-client';

const QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // Dashboards re-render frequently; keep data fresh for 30s and let
      // the user pull-to-refresh / navigation refetch handle the rest.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry on 4xx — the request is wrong, not flaky.
        if (
          error instanceof ApiClientError &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
};

interface QueryProviderProps {
  children: ReactNode;
}

/**
 * Root provider for `@tanstack/react-query`.
 *
 * Lives in a `'use client'` component so the QueryClient is created on
 * the client and not shared across requests in SSR (avoiding a memory
 * leak / cross-tenant cache bleed).
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const [client] = useState(() => new QueryClient(QUERY_CLIENT_CONFIG));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
