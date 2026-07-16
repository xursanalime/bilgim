import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AdminActivity } from './admin-activity';
import { adminApi, type AdminActivityItem } from '../../lib/api/admin';

jest.mock('../../lib/api/admin', () => ({
  adminApi: { getRecentActivity: jest.fn() },
}));

const mockGetActivity = adminApi.getRecentActivity as jest.MockedFunction<
  typeof adminApi.getRecentActivity
>;

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ITEMS: AdminActivityItem[] = [
  {
    id: '1',
    type: 'user',
    title: 'Yangi foydalanuvchi',
    description: 'student@bilgim.uz',
    createdAt: '2024-05-01T10:00:00.000Z',
  },
  {
    id: '2',
    type: 'payment',
    title: "To'lov qabul qilindi",
    description: null,
    createdAt: '2024-05-01T11:30:00.000Z',
  },
];

describe('AdminActivity', () => {
  beforeEach(() => {
    mockGetActivity.mockReset();
  });

  it('renders feed entries returned by the api', async () => {
    mockGetActivity.mockResolvedValue({ items: ITEMS });
    renderWithClient(<AdminActivity />);

    expect(await screen.findByText('Yangi foydalanuvchi')).toBeInTheDocument();
    expect(screen.getByText('student@bilgim.uz')).toBeInTheDocument();
    expect(screen.getByText("To'lov qabul qilindi")).toBeInTheDocument();
  });

  it('renders an empty state when there are no entries', async () => {
    mockGetActivity.mockResolvedValue({ items: [] });
    renderWithClient(<AdminActivity />);

    expect(await screen.findByText("Hozircha harakatlar yo'q")).toBeInTheDocument();
  });

  it('renders an actionable error state when the request fails', async () => {
    mockGetActivity.mockRejectedValue(new Error('boom'));
    renderWithClient(<AdminActivity />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'Qayta urinish' }),
    ).toBeInTheDocument();
  });

  it('requests the feed with the provided limit', async () => {
    mockGetActivity.mockResolvedValue({ items: [] });
    renderWithClient(<AdminActivity limit={5} />);

    await waitFor(() => {
      expect(mockGetActivity).toHaveBeenCalledWith({ limit: 5 });
    });
  });
});
