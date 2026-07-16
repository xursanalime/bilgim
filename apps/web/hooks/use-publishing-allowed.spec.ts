import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { usePublishingAllowed } from './use-publishing-allowed';
import { billingApi, type Subscription } from '../lib/api/billing';
import { getUserRole } from '../lib/auth';

jest.mock('../lib/api/billing', () => ({
  billingApi: { getSubscription: jest.fn() },
}));
jest.mock('../lib/auth', () => ({
  getUserRole: jest.fn(),
}));

const getSubscription = billingApi.getSubscription as jest.MockedFunction<
  typeof billingApi.getSubscription
>;
const mockedGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return wrapper;
}

function sub(status: Subscription['status']): Subscription {
  return {
    id: 's1',
    status,
    planId: null,
    plan: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('usePublishingAllowed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserRole.mockReturnValue('TEACHER');
  });

  it('blocks publishing when subscription is EXPIRED', async () => {
    getSubscription.mockResolvedValue(sub('EXPIRED'));
    const { result } = renderHook(() => usePublishingAllowed(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.allowed).toBe(false);
    expect(result.current.status).toBe('EXPIRED');
    expect(result.current.reason).toMatch(/muddati tugagani/);
  });

  it('blocks publishing when subscription is CANCELED', async () => {
    getSubscription.mockResolvedValue(sub('CANCELED'));
    const { result } = renderHook(() => usePublishingAllowed(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toMatch(/bekor qilingani/);
  });

  it('allows publishing when subscription is ACTIVE', async () => {
    getSubscription.mockResolvedValue(sub('ACTIVE'));
    const { result } = renderHook(() => usePublishingAllowed(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe('ACTIVE'));
    expect(result.current.allowed).toBe(true);
    expect(result.current.blocked).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it('allows publishing for non-teachers without fetching', () => {
    mockedGetUserRole.mockReturnValue('STUDENT');
    const { result } = renderHook(() => usePublishingAllowed(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.allowed).toBe(true);
    expect(result.current.blocked).toBe(false);
    expect(getSubscription).not.toHaveBeenCalled();
  });
});
