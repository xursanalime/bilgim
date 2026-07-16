import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { EnrollmentStatus } from './enrollment-status';
import { enrollmentApi, type EnrollmentRequest } from '../../lib/api/enrollment';
import { billingApi } from '../../lib/api/billing';
import { studentApi } from '../../lib/api/student';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('../../lib/api/enrollment', () => ({
  enrollmentApi: { myRequests: jest.fn(), cancelRequest: jest.fn() },
}));
jest.mock('../../lib/api/billing', () => ({
  billingApi: { checkout: jest.fn() },
}));
jest.mock('../../lib/api/student', () => ({
  studentApi: { getGroup: jest.fn() },
}));

const myRequests = enrollmentApi.myRequests as jest.MockedFunction<
  typeof enrollmentApi.myRequests
>;
const cancelRequest = enrollmentApi.cancelRequest as jest.MockedFunction<
  typeof enrollmentApi.cancelRequest
>;
const checkout = billingApi.checkout as jest.MockedFunction<typeof billingApi.checkout>;
const getGroup = studentApi.getGroup as jest.Mock;

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function req(overrides: Partial<EnrollmentRequest> & { id: string }): EnrollmentRequest {
  return {
    groupId: `grp-${overrides.id}`,
    studentId: 'stu-1',
    status: 'PENDING_APPROVAL',
    message: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

describe('EnrollmentStatus', () => {
  beforeEach(() => {
    myRequests.mockReset();
    cancelRequest.mockReset();
    checkout.mockReset();
    getGroup.mockReset();
    getGroup.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        courseId: 'c1',
        name: `Guruh ${id}`,
        priceUzs: 0,
        capacity: null,
        startsOn: null,
        endsOn: null,
        status: 'ACTIVE',
      }),
    );
  });

  it('renders a localized status label and description per request status', async () => {
    myRequests.mockResolvedValue([
      req({ id: 'a', status: 'PENDING_PAYMENT' }),
      req({ id: 'b', status: 'PENDING_APPROVAL' }),
      req({ id: 'c', status: 'APPROVED' }),
      req({ id: 'd', status: 'REJECTED', reason: 'Joy qolmadi' }),
      req({ id: 'e', status: 'REVOKED' }),
    ]);

    renderWithClient(<EnrollmentStatus locale="uz" />);

    expect(await screen.findByText('Toʻlov kutilmoqda')).toBeInTheDocument();
    expect(screen.getByText('Tasdiq kutilmoqda')).toBeInTheDocument();
    expect(screen.getByText('Tasdiqlangan')).toBeInTheDocument();
    expect(screen.getByText('Rad etilgan')).toBeInTheDocument();
    expect(screen.getByText('Bekor qilingan')).toBeInTheDocument();

    // Rejection reason is surfaced when present.
    expect(screen.getByText(/Joy qolmadi/)).toBeInTheDocument();
  });

  it('renders the Payme checkout CTA only for PENDING_PAYMENT and triggers checkout', async () => {
    myRequests.mockResolvedValue([
      req({ id: 'a', status: 'PENDING_PAYMENT' }),
      req({ id: 'b', status: 'PENDING_APPROVAL' }),
    ]);
    checkout.mockResolvedValue({
      invoiceId: 'inv-1',
      payUrl: 'https://checkout.paycom.uz/abc',
      amountUzs: 100000,
    });

    renderWithClient(<EnrollmentStatus locale="uz" />);

    // Exactly one pay CTA (only the PENDING_PAYMENT row exposes it).
    const payButtons = await screen.findAllByRole('button', {
      name: /Payme orqali toʻlash/,
    });
    expect(payButtons).toHaveLength(1);

    await userEvent.click(payButtons[0]!);

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith({ kind: 'STUDENT_COURSE', groupId: 'grp-a' });
    });
  });

  it('cancels a PENDING_APPROVAL request', async () => {
    myRequests.mockResolvedValue([req({ id: 'b', status: 'PENDING_APPROVAL' })]);
    cancelRequest.mockResolvedValue(undefined as unknown as void);

    renderWithClient(<EnrollmentStatus locale="uz" />);

    const cancelBtn = await screen.findByRole('button', { name: 'Bekor qilish' });
    await userEvent.click(cancelBtn);

    await waitFor(() => {
      expect(cancelRequest).toHaveBeenCalledWith('b');
    });
  });

  it('shows an empty state when there are no requests', async () => {
    myRequests.mockResolvedValue([]);
    renderWithClient(<EnrollmentStatus locale="uz" />);
    expect(await screen.findByText('Aʼzolik soʻrovlari yoʻq')).toBeInTheDocument();
  });

  it('shows an actionable error state when the request fails', async () => {
    myRequests.mockRejectedValue(new Error('boom'));
    renderWithClient(<EnrollmentStatus locale="uz" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Qayta urinish' })).toBeInTheDocument();
  });
});
