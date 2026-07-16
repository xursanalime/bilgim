'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Users,
  GraduationCap,
  UserRound,
  CreditCard,
  Wallet,
  Radio,
  AlertTriangle,
} from 'lucide-react';

import { adminApi, type AdminDashboardStats } from '../../lib/api/admin';
import { ApiClientError } from '../../lib/api-client';
import { StatCard } from '../ui/card';
import { LoadingState } from '../states/loading-state';
import { ErrorState } from '../states/error-state';

/**
 * Admin dashboard KPI stat cards (task 13.1, Req 17.1).
 *
 * Reads the consolidated `GET /admin/stats` counters via the typed
 * `adminApi.getDashboardStats` wrapper and renders one `StatCard` per metric.
 * Loading and error are handled with the shared state primitives so the
 * surface never silently fails. Copy is localized in Uzbek (uz).
 */

interface KpiSpec {
  key: keyof AdminDashboardStats;
  label: string;
  icon: typeof Users;
  accent: 'blue' | 'green' | 'orange' | 'red' | 'purple';
  /** When true, the value is rendered as UZS currency. */
  currency?: boolean;
}

const KPI_SPECS: readonly KpiSpec[] = [
  { key: 'totalUsers', label: 'Jami foydalanuvchilar', icon: Users, accent: 'blue' },
  { key: 'totalTeachers', label: "O'qituvchilar", icon: GraduationCap, accent: 'green' },
  { key: 'totalStudents', label: 'Talabalar', icon: UserRound, accent: 'purple' },
  {
    key: 'activeSubscriptions',
    label: 'Faol obunalar',
    icon: CreditCard,
    accent: 'orange',
  },
  { key: 'revenueUzs', label: 'Daromad', icon: Wallet, accent: 'green', currency: true },
  { key: 'liveSessions', label: 'Jonli darslar', icon: Radio, accent: 'red' },
];

const numberFormatter = new Intl.NumberFormat('uz-UZ');

function formatValue(value: number, currency?: boolean): string {
  if (currency) {
    return `${numberFormatter.format(Math.round(value))} so'm`;
  }
  return numberFormatter.format(value);
}

export function AdminKpis() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: () => adminApi.getDashboardStats(),
  });

  if (isLoading) {
    return <LoadingState variant="card" count={6} label="Ko'rsatkichlar yuklanmoqda…" />;
  }

  if (isError || !data) {
    return (
      <ErrorState
        icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
        title="Ko'rsatkichlarni yuklab bo'lmadi"
        message={
          error instanceof ApiClientError
            ? error.message
            : "Statistik ma'lumotlarni olishda xatolik yuz berdi."
        }
        retryLabel="Qayta urinish"
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {KPI_SPECS.map((spec) => {
        const Icon = spec.icon;
        return (
          <StatCard
            key={spec.key}
            label={spec.label}
            value={formatValue(data[spec.key], spec.currency)}
            accent={spec.accent}
            icon={<Icon className="h-5 w-5" aria-hidden="true" />}
          />
        );
      })}
    </div>
  );
}
