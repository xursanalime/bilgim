'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import {
  Users,
  TrendingUp,
  Layers,
  CreditCard,
  BookOpen,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  GraduationCap,
  AlertCircle
} from 'lucide-react';

import {
  teacherAnalyticsApi,
  type TeacherAnalyticsOverview,
  type TeacherAnalyticsRevenuePoint,
  type TeacherAnalyticsStudentRow,
} from '../../lib/api/teacher-analytics';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface TeacherAnalyticsPageProps {
  locale: string;
}

export function TeacherAnalyticsPage({ locale }: TeacherAnalyticsPageProps) {
  const overviewQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'overview'],
    queryFn: () => teacherAnalyticsApi.overview(),
  });
  const revenueQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'revenue'],
    queryFn: () => teacherAnalyticsApi.revenue(),
  });
  const studentsQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'students'],
    queryFn: () => teacherAnalyticsApi.students(),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[1.5rem] border border-rim bg-white p-4 shadow-soft sm:rounded-[2.5rem] sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2.5 text-[9px] font-bold uppercase tracking-[0.25em] text-blue sm:text-[10px]">
              <TrendingUp className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              Hisobotlar va Tahlil
            </div>

            <div className="space-y-1 sm:space-y-2">
              <h1 className="font-display text-xl font-extrabold tracking-tight text-ink-strong sm:text-3xl lg:text-4xl">
                Analitika
              </h1>
              <p className="max-w-xl text-xs leading-relaxed text-ink-soft opacity-80 sm:text-sm">
                Talabalar faolligi, daromad va oʻquv jarayoni boʻyicha koʻrsatkichlar.
              </p>
            </div>
          </div>
        </div>
      </header>

      <KpiSection
        data={overviewQuery.data}
        isLoading={overviewQuery.isLoading}
        error={errorMessage(overviewQuery.error)}
      />

      <div className="grid gap-6 sm:gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChartSection
            data={revenueQuery.data ?? []}
            isLoading={revenueQuery.isLoading}
            error={errorMessage(revenueQuery.error)}
          />
        </div>
        <div>
          <ActivitySummarySection 
            data={overviewQuery.data}
            isLoading={overviewQuery.isLoading}
          />
        </div>
      </div>

      <GroupBreakdownSection
        data={studentsQuery.data ?? []}
        isLoading={studentsQuery.isLoading}
        error={errorMessage(studentsQuery.error)}
        locale={locale}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPI cards
// ──────────────────────────────────────────────────────────────────────

function KpiSection({ data, isLoading, error }: KpiSectionProps) {
  const kpis = useMemo(
    () => [
      {
        label: 'Talabalar',
        value: data?.totalStudents ?? 0,
        hint: 'Jami aʼzolar',
        icon: Users,
        color: 'blue' as const,
      },
      {
        label: 'Faol',
        value: data?.activeStudents30d ?? 0,
        hint: 'Oxirgi 30 kun',
        icon: TrendingUp,
        color: 'green' as const,
      },
      {
        label: 'Daromad',
        value: formatUzs(data?.revenueLast30dUzs ?? 0),
        hint: 'Oxirgi 30 kun',
        icon: CreditCard,
        color: 'purple' as const,
      },
      {
        label: 'Guruhlar',
        value: `${data?.activeGroups ?? 0}/${data?.totalGroups ?? 0}`,
        hint: 'Faol guruhlar',
        icon: Layers,
        color: 'orange' as const,
      },
    ],
    [data],
  );

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-extrabold text-ink-strong sm:text-lg">Asosiy koʻrsatkichlar</h2>
        <div className="h-px flex-1 bg-rim" />
      </div>
      
      {error ? <ErrorBanner message={error} /> : null}
      
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="group relative overflow-hidden rounded-[1.25rem] border border-rim bg-white p-4 shadow-soft transition-all duration-300 hover:shadow-medium sm:rounded-[2rem] sm:p-6"
          >
            <div className="flex items-start justify-between">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm sm:h-12 sm:w-12 sm:rounded-2xl",
                kpi.color === 'blue' && "bg-blue/5 text-blue",
                kpi.color === 'green' && "bg-teal/5 text-teal",
                kpi.color === 'purple' && "bg-purple/5 text-purple",
                kpi.color === 'orange' && "bg-orange/5 text-orange",
              )}>
                <kpi.icon className="h-4 w-4 sm:h-6 sm:w-6" />
              </div>
            </div>
            
            <div className="mt-3 space-y-0.5 sm:mt-5 sm:space-y-1">
              <p className="text-[8px] font-bold uppercase tracking-wider text-ink-faint sm:text-[10px]">{kpi.label}</p>
              <h3 className="font-display text-sm font-black text-ink-strong sm:text-2xl">
                {isLoading ? <div className="h-6 w-16 animate-pulse rounded bg-tint sm:h-8 sm:w-20" /> : kpi.value}
              </h3>
              <p className="text-[9px] font-medium text-ink-soft opacity-70 sm:text-xs">{kpi.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Revenue Chart
// ──────────────────────────────────────────────────────────────────────

function RevenueChartSection({
  data,
  isLoading,
  error,
}: RevenueChartSectionProps) {
  const max = useMemo(
    () => data.reduce((m, p) => (p.totalUzs > m ? p.totalUzs : m), 0) || 1,
    [data],
  );
  const total = useMemo(
    () => data.reduce((sum, p) => sum + p.totalUzs, 0),
    [data],
  );

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-base font-extrabold text-ink-strong sm:text-lg">Daromad dinamikasi</h2>
        <div className="inline-flex w-fit items-center gap-2 rounded-xl bg-blue/5 px-3 py-1.5 text-blue">
          <span className="text-[9px] font-bold uppercase tracking-wider sm:text-[10px]">Jami:</span>
          <span className="text-xs font-black">{formatUzs(total)} UZS</span>
        </div>
      </div>
      
      {error ? <ErrorBanner message={error} /> : null}
      
      <div className="relative w-full overflow-hidden rounded-[1.5rem] border border-rim bg-white p-4 shadow-soft sm:rounded-[2.5rem] sm:p-8">
        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-purple/5 blur-[100px]" />
        
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-blue border-t-transparent sm:h-8 sm:w-8" />
              <p className="text-[10px] font-bold text-ink-faint sm:text-xs">Yuklanmoqda...</p>
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center">
            <CreditCard className="mb-2 h-8 w-8 text-ink-faint opacity-20 sm:h-10 sm:w-10" />
            <p className="text-xs font-medium text-ink-faint sm:text-sm">
              Soʻnggi 30 kun ichida toʻlovlar mavjud emas.
            </p>
          </div>
        ) : (
          <div className="w-full overflow-hidden">
            <RevenueBars data={data} max={max} />
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-ink-faint opacity-40 sm:text-[10px]">
              <div className="h-px flex-1 bg-rim" />
              Soʻnggi 30 kunlik koʻrsatkichlar
              <div className="h-px flex-1 bg-rim" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function RevenueBars({ data, max }: RevenueBarsProps) {
  const HEIGHT = 140; 
  
  return (
    <div className="w-full overflow-hidden scrollbar-hide">
      <svg
        role="img"
        aria-label="Daromad grafigi"
        width="100%"
        height={HEIGHT + 30}
        viewBox={`0 0 ${data.length * 20} ${HEIGHT + 30}`}
        preserveAspectRatio="none"
        className="w-full"
      >
        <defs>
          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0071e3" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0071e3" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        
        {data.map((point, i) => {
          const ratio = point.totalUzs / max;
          const barH = Math.max(ratio * HEIGHT, 2);
          const BAR_WIDTH = 12;
          const BAR_GAP = 8;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = HEIGHT - barH;
          
          return (
            <g key={point.date} className="group/bar">
              <rect
                x={x}
                y={0}
                width={BAR_WIDTH}
                height={HEIGHT}
                rx={BAR_WIDTH / 2}
                className="fill-tint/30"
              />
              <rect
                x={x}
                y={y}
                width={BAR_WIDTH}
                height={barH}
                rx={BAR_WIDTH / 2}
                fill="url(#barGradient)"
                className="transition-all duration-500 hover:brightness-110"
              >
                <title>{`${point.date}: ${formatUzs(point.totalUzs)} UZS`}</title>
              </rect>
              {(i % 7 === 0 || i === data.length - 1) ? (
                <text
                  x={x + BAR_WIDTH / 2}
                  y={HEIGHT + 18}
                  textAnchor="middle"
                  className="fill-ink-faint text-[8px] font-bold"
                >
                  {new Date(point.date).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' })}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Activity Summary
// ──────────────────────────────────────────────────────────────────────

function ActivitySummarySection({ data, isLoading }: { data: TeacherAnalyticsOverview | undefined, isLoading: boolean }) {
  const items = [
    { label: 'Nashr etilgan kurslar', value: data?.publishedCourses ?? 0, total: data?.totalCourses ?? 0, icon: BookOpen, color: 'blue' },
    { label: 'Toʻlangan invoyslar', value: data?.paidInvoicesLast30d ?? 0, icon: GraduationCap, color: 'purple' },
  ];

  return (
    <section className="space-y-4 sm:space-y-6">
      <h2 className="font-display text-base font-extrabold text-ink-strong sm:text-lg">Oʻquv faolligi</h2>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-1">
        {items.map((item) => (
          <div key={item.label} className="group relative overflow-hidden rounded-[1.25rem] border border-rim bg-white p-4 shadow-soft transition-all duration-300 hover:shadow-medium sm:rounded-3xl sm:p-5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-12 sm:w-12 sm:rounded-2xl",
                item.color === 'blue' ? "bg-blue/5 text-blue" : "bg-purple/5 text-purple"
              )}>
                <item.icon className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[8px] font-bold uppercase tracking-wider text-ink-faint sm:text-[10px]">{item.label}</p>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-sm font-black text-ink-strong sm:text-xl">
                    {isLoading ? '...' : item.value}
                  </span>
                  {item.total !== undefined && (
                    <span className="text-[10px] font-bold text-ink-faint sm:text-sm">/ {item.total}</span>
                  )}
                </div>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Group breakdown — aggregate rollup, not a duplicate of the per-group
// Jurnal (journal) roster or the /students CRM list. Derived client-side
// from the same `students` read the Jurnal uses, so no new endpoint.
// ──────────────────────────────────────────────────────────────────────

interface GroupRollupRow {
  groupId: string;
  groupName: string;
  studentCount: number;
  paidCount: number;
  averageGrade: number | null;
}

function GroupBreakdownSection({
  data,
  isLoading,
  error,
  locale,
}: GroupBreakdownSectionProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const groups = useMemo<GroupRollupRow[]>(() => {
    const byGroup = new Map<
      string,
      { groupName: string; studentCount: number; paidCount: number; gradedScores: number[] }
    >();
    for (const row of data) {
      const bucket = byGroup.get(row.groupId) ?? {
        groupName: row.groupName,
        studentCount: 0,
        paidCount: 0,
        gradedScores: [],
      };
      bucket.studentCount += 1;
      if (row.paymentStatus === 'PAID') bucket.paidCount += 1;
      if (row.averageGrade !== null) bucket.gradedScores.push(row.averageGrade);
      byGroup.set(row.groupId, bucket);
    }
    return Array.from(byGroup.entries())
      .map(([groupId, bucket]) => ({
        groupId,
        groupName: bucket.groupName,
        studentCount: bucket.studentCount,
        paidCount: bucket.paidCount,
        averageGrade:
          bucket.gradedScores.length === 0
            ? null
            : bucket.gradedScores.reduce((sum, v) => sum + v, 0) / bucket.gradedScores.length,
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }, [data]);

  const studentsByGroup = useMemo(() => {
    const map = new Map<string, TeacherAnalyticsStudentRow[]>();
    for (const row of data) {
      const list = map.get(row.groupId) ?? [];
      list.push(row);
      map.set(row.groupId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email));
    }
    return map;
  }, [data]);

  function toggleGroup(groupId: string) {
    setExpandedGroupId((current) => (current === groupId ? null : groupId));
  }

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-extrabold text-ink-strong sm:text-lg">Guruhlar boʻyicha koʻrsatkichlar</h2>
        <Link
          href={`/${locale}/students`}
          className="group flex shrink-0 items-center gap-1 rounded-full border border-rim px-3 py-1.5 text-[9px] font-bold text-ink-soft transition-all hover:border-blue/30 hover:text-blue sm:text-[10px]"
        >
          Barcha talabalar
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-hidden rounded-[1.25rem] border border-rim bg-white shadow-soft sm:rounded-[2.5rem]">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="min-w-full border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-tint/30 text-[8px] font-bold uppercase tracking-[0.15em] text-ink-faint sm:text-[10px]">
                <th className="px-4 py-4 text-left sm:px-8 sm:py-5">Guruh</th>
                <th className="px-3 py-4 text-center sm:px-6 sm:py-5">Talabalar</th>
                <th className="px-3 py-4 text-center sm:px-6 sm:py-5">Toʻlangan</th>
                <th className="px-4 py-4 text-right sm:px-8 sm:py-5">Oʻrtacha baho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rim">
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={4} className="px-4 py-5 sm:px-8 sm:py-6"><div className="h-3 rounded bg-tint sm:h-4" /></td>
                  </tr>
                ))
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-ink-faint font-medium sm:px-8 sm:py-16">
                    Hozircha guruh maʼlumotlari mavjud emas.
                  </td>
                </tr>
              ) : (
                groups.map((g) => {
                  const paidRatio = g.studentCount === 0 ? 0 : g.paidCount / g.studentCount;
                  const isExpanded = expandedGroupId === g.groupId;
                  return (
                    <Fragment key={g.groupId}>
                      <tr className="group transition-colors hover:bg-tint/20">
                        <td className="px-4 py-4 sm:px-8 sm:py-5">
                          <span className="inline-flex rounded-lg bg-purple/5 px-2 py-0.5 text-[9px] font-bold text-purple border border-purple/10 whitespace-nowrap sm:px-2.5 sm:py-1 sm:text-xs">
                            {g.groupName}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-center sm:px-6 sm:py-5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(g.groupId)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 font-black text-ink-strong transition-colors hover:text-blue"
                          >
                            {g.studentCount}
                            <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} />
                          </button>
                        </td>
                        <td className="px-3 py-4 text-center sm:px-6 sm:py-5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(g.groupId)}
                            aria-expanded={isExpanded}
                            className={cn(
                              "font-black underline-offset-4 transition-colors hover:underline",
                              paidRatio >= 0.8 ? "text-teal" : paidRatio >= 0.5 ? "text-orange" : "text-red"
                            )}
                          >
                            {g.paidCount}/{g.studentCount}
                          </button>
                        </td>
                        <td className="px-4 py-4 text-right sm:px-8 sm:py-5">
                          {g.averageGrade === null ? (
                            <span className="text-ink-faint">—</span>
                          ) : (
                            <span className={cn(
                              "font-black",
                              g.averageGrade >= 80 ? "text-teal" : g.averageGrade >= 60 ? "text-orange" : "text-red"
                            )}>
                              {g.averageGrade.toFixed(1)}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={4} className="bg-tint/20 px-4 py-4 sm:px-8 sm:py-5">
                            <div className="space-y-2">
                              {(studentsByGroup.get(g.groupId) ?? []).map((s) => (
                                <div
                                  key={s.studentId}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rim bg-white px-3 py-2 sm:px-4 sm:py-2.5"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-bold text-ink-strong sm:text-sm">
                                      {s.fullName ?? s.email}
                                    </p>
                                    <p className="truncate text-[10px] font-medium text-ink-faint sm:text-[11px]">
                                      {s.email}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-3">
                                    {s.averageGrade !== null && (
                                      <span className={cn(
                                        "text-[11px] font-black sm:text-xs",
                                        s.averageGrade >= 80 ? "text-teal" : s.averageGrade >= 60 ? "text-orange" : "text-red"
                                      )}>
                                        {s.averageGrade.toFixed(1)}
                                      </span>
                                    )}
                                    <PaymentBadge status={s.paymentStatus} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PaymentBadge({ status }: { status: TeacherAnalyticsStudentRow['paymentStatus'] }) {
  if (status === 'PAID') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-lg border border-teal/20 bg-teal/10 px-2 py-0.5 text-[9px] font-bold text-teal sm:text-[10px]">
        Toʻlangan
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-lg border border-orange/20 bg-orange/10 px-2 py-0.5 text-[9px] font-bold text-orange sm:text-[10px]">
        Kutilmoqda
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-lg border border-rim bg-tint px-2 py-0.5 text-[9px] font-bold text-ink-faint sm:text-[10px]">
      Toʻlovsiz
    </span>
  );
}

// ── Shared Helpers ──────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[1rem] border border-red/20 bg-red-tint p-3 text-xs font-medium text-red sm:rounded-2xl sm:p-4 sm:text-sm">
      <AlertCircle className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
      {message}
    </div>
  );
}

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Xatolik yuz berdi.';
}

function formatUzs(value: number): string {
  return new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(
    value,
  );
}

interface KpiSectionProps {
  data: TeacherAnalyticsOverview | undefined;
  isLoading: boolean;
  error: string | null;
}

interface RevenueChartSectionProps {
  data: TeacherAnalyticsRevenuePoint[];
  isLoading: boolean;
  error: string | null;
}

interface RevenueBarsProps {
  data: TeacherAnalyticsRevenuePoint[];
  max: number;
}

interface GroupBreakdownSectionProps {
  data: TeacherAnalyticsStudentRow[];
  isLoading: boolean;
  error: string | null;
  locale: string;
}
