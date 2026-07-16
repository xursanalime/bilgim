import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AdminKpis } from './admin-kpis';
import { adminApi, type AdminDashboardStats } from '../../lib/api/admin';

jest.mock('../../lib/api/admin', () => ({
  adminApi: { getDashboardStats: jest.fn() },
}));

const mockGetStats = adminApi.getDashboardStats as jest.MockedFunction<
  typeof adminApi.getDashboardStats
>;

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const STATS: AdminDashboardStats = {
  totalUsers: 1234,
  totalTeachers: 56,
  totalStudents: 1100,
  activeSubscriptions: 78,
  revenueUzs: 4500000,
  liveSessions: 3,
};

describe('AdminKpis', () => {
  beforeEach(() => {
    mockGetStats.mockReset();
  });

  it('renders a stat card per KPI with localized labels and values', async () => {
    mockGetStats.mockResolvedValue(STATS);
    renderWithClient(<AdminKpis />);

    expect(await screen.findByText('Jami foydalanuvchilar')).toBeInTheDocument();
    expect(screen.getByText("O'qituvchilar")).toBeInTheDocument();
    expect(screen.getByText('Talabalar')).toBeInTheDocument();
    expect(screen.getByText('Faol obunalar')).toBeInTheDocument();
    expect(screen.getByText('Daromad')).toBeInTheDocument();
    expect(screen.getByText('Jonli darslar')).toBeInTheDocument();

    // Digits-only comparison avoids brittleness around the uz-UZ grouping
    // separator (a non-breaking space that testing-library normalizes).
    const digitsOnly = (s: string) => s.replace(/\D/g, '');

    // Plain count is formatted with the uz-UZ grouping separator.
    expect(
      screen.getByText((content) => digitsOnly(content) === '1234'),
    ).toBeInTheDocument();

    // Revenue is rendered as UZS currency (suffixed with "so'm").
    expect(
      screen.getByText(
        (content) => digitsOnly(content) === '4500000' && /so'm/.test(content),
      ),
    ).toBeInTheDocument();
  });

  it('shows an actionable error state when the request fails', async () => {
    mockGetStats.mockRejectedValue(new Error('boom'));
    renderWithClient(<AdminKpis />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'Qayta urinish' }),
    ).toBeInTheDocument();
  });
});
