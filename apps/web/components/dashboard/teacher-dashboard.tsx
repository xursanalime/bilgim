'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useEffect, useState } from 'react';
import { 
  Users, 
  BookOpen, 
  Layers, 
  CreditCard, 
  ArrowRight, 
  GraduationCap,
  LayoutDashboard,
  CheckCircle2,
  BarChart3,
  TrendingUp,
  Trophy
} from 'lucide-react';

import {
  TEACHER_HOMEWORK_STATUSES,
  teacherAnalyticsApi,
  type TeacherAnalyticsHomeworkStats,
  type TeacherAnalyticsOverview,
  type TeacherAnalyticsTopCourse,
  type TeacherAnalyticsTrendPoint,
  type TeacherHomeworkStatusKey,
} from '../../lib/api/teacher-analytics';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser, type DecodedToken } from '../../lib/auth';

interface TeacherDashboardProps {
  locale: string;
}

export function TeacherDashboard({ locale }: TeacherDashboardProps) {
  const [user, setUser] = useState<DecodedToken | null>(null);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  const overviewQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'overview'],
    queryFn: () => teacherAnalyticsApi.overview(),
  });
  const enrollmentTrendQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'enrollment-trend', 30],
    queryFn: () => teacherAnalyticsApi.enrollmentTrend(30),
  });
  const topCoursesQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'top-courses', 5],
    queryFn: () => teacherAnalyticsApi.topCourses(5),
  });
  const homeworkStatsQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'homework-stats'],
    queryFn: () => teacherAnalyticsApi.homeworkStats(),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <header className="group relative overflow-hidden rounded-3xl border border-blue/10 bg-white p-8 shadow-[0_32px_64px_-16px_rgba(0,113,227,0.08)] transition-all hover:shadow-[0_48px_80px_-16px_rgba(0,113,227,0.12)] sm:p-10">
        {/* Animated Aurora backgrounds */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-[300px] w-[300px] rounded-full bg-blue/5 blur-[80px] transition-all group-hover:bg-blue/10" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-purple/5 blur-[80px] transition-all group-hover:bg-purple/10" />
        
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue"></span>
              </span>
              Boshqaruv paneli
            </div>
            
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                Xush kelibsiz, <span className="text-blue">{user?.email.split('@')[0] || 'Ustoz'}</span>!
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
                Talabalar, kurslar va daromad boʻyicha barcha koʻrsatkichlarni bitta zamonaviy interfeysda kuzating.
              </p>
            </div>

          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/${locale}/dashboard/courses/new`}
              className="group/btn relative inline-flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 hover:shadow-[0_16px_32px_-8px_rgba(0,113,227,0.6)] active:scale-[0.98]"
            >
              <BookOpen className="h-4 w-4" />
              <span>Yangi kurs</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
            
            <Link
              href={`/${locale}/teacher/analytics`}
              className="flex items-center gap-2 rounded-2xl border border-rim bg-tint px-6 py-3 text-sm font-bold text-ink-strong transition-all hover:bg-canvas hover:border-blue/30 active:scale-[0.98]"
            >
              <BarChart3 className="h-4 w-4 text-blue" />
              <span>Analitika</span>
            </Link>
          </div>
        </div>
      </header>

      <KpiGrid
        data={overviewQuery.data}
        isLoading={overviewQuery.isLoading}
        error={errorMessage(overviewQuery.error)}
      />

      <div className="grid items-stretch gap-8 lg:grid-cols-2">
        <EnrollmentTrendCard
          data={enrollmentTrendQuery.data ?? []}
          isLoading={enrollmentTrendQuery.isLoading}
          error={errorMessage(enrollmentTrendQuery.error)}
        />
        <HomeworkDonutCard
          data={homeworkStatsQuery.data}
          isLoading={homeworkStatsQuery.isLoading}
          error={errorMessage(homeworkStatsQuery.error)}
        />
      </div>

      <div className="grid items-stretch gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TopCoursesCard
            locale={locale}
            data={topCoursesQuery.data ?? []}
            isLoading={topCoursesQuery.isLoading}
            error={errorMessage(topCoursesQuery.error)}
          />
        </div>
        <div>
          <QuickActions locale={locale} />
        </div>
      </div>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-ink-faint/10 ${className}`} />
  );
}

// ──────────────────────────────────────────────────────────────────────
// 2x2 KPI grid
// ──────────────────────────────────────────────────────────────────────

interface KpiGridProps {
  data: TeacherAnalyticsOverview | undefined;
  isLoading: boolean;
  error: string | null;
}

function KpiGrid({ data, isLoading, error }: KpiGridProps) {
  const kpis = useMemo(
    () => [
      {
        label: 'Talabalar',
        value: isLoading ? null : String(data?.totalStudents ?? 0),
        hint: `${data?.activeStudents30d ?? 0} faol (30 kun)`,
        color: 'text-blue',
        icon: Users,
      },
      {
        label: 'Kurslar',
        value: isLoading
          ? null
          : `${data?.publishedCourses ?? 0} / ${data?.totalCourses ?? 0}`,
        hint: 'Nashr etilgan / jami',
        color: 'text-teal',
        icon: BookOpen,
      },
      {
        label: 'Guruhlar',
        value: isLoading
          ? null
          : `${data?.activeGroups ?? 0} / ${data?.totalGroups ?? 0}`,
        hint: 'Faol / jami',
        color: 'text-purple',
        icon: Layers,
      },
      {
        label: 'Daromad (30 kun)',
        value: isLoading ? null : `${formatUzs(data?.revenueLast30dUzs ?? 0)} soʻm`,
        hint: `${data?.paidInvoicesLast30d ?? 0} ta toʻlov`,
        color: 'text-orange',
        icon: CreditCard,
      },
    ],
    [data, isLoading],
  );

  return (
    <section aria-label="Asosiy koʻrsatkichlar">
      {error ? <ErrorBanner message={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all hover:-translate-y-1 hover:shadow-medium hover:border-blue/20"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-tint p-2.5 transition-colors group-hover:bg-blue-tint">
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                {kpi.label}
              </div>
            </div>
            
            <div className="mt-4">
              {kpi.value === null ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <div className="font-display text-xl font-extrabold tracking-tight text-ink-strong">
                  {kpi.value}
                </div>
              )}
              <div className="mt-0.5 text-[11px] font-medium text-ink-soft">
                {kpi.hint}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Enrollment trend sparkline
// ──────────────────────────────────────────────────────────────────────

interface EnrollmentTrendCardProps {
  data: TeacherAnalyticsTrendPoint[];
  isLoading: boolean;
  error: string | null;
}

function EnrollmentTrendCard({
  data,
  isLoading,
  error,
}: EnrollmentTrendCardProps) {
  const total = useMemo(
    () => data.reduce((sum, p) => sum + p.value, 0),
    [data],
  );

  return (
    <section className="flex h-full flex-col rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-tint">
            <TrendingUp className="h-4.5 w-4.5 text-blue" />
          </div>
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-ink-strong">
              Yangi yozilishlar
            </h2>
            <p className="text-xs text-ink-soft">Oxirgi 30 kunlik dinamika</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xl font-bold text-blue">{total}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
            Jami talaba
          </span>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="mt-6 flex flex-1 min-h-[140px] flex-col justify-center">
        {isLoading ? (
          <div className="flex h-[100px] items-end gap-1.5">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="flex-1 rounded-full bg-tint animate-pulse" style={{ height: `${Math.random() * 60 + 20}%` }} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[100px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft">
            <LayoutDashboard className="mb-2 h-6 w-6 opacity-20" />
            Hozircha maʼlumot yoʻq
          </div>
        ) : (
          <div className="relative pt-2">
            <Sparkline data={data} />
          </div>
        )}
      </div>
    </section>
  );
}

interface SparklineProps {
  data: TeacherAnalyticsTrendPoint[];
}

function Sparkline({ data }: SparklineProps) {
  const WIDTH = 600;
  const HEIGHT = 120;
  const PAD = 4;

  const max = Math.max(1, ...data.map((p) => p.value));
  const stepX = data.length > 1 ? (WIDTH - PAD * 2) / (data.length - 1) : 0;

  const points = data.map((p, i) => {
    const x = PAD + i * stepX;
    const ratio = p.value / max;
    const y = HEIGHT - PAD - ratio * (HEIGHT - PAD * 2);
    return { x, y, ...p };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${(points[points.length - 1]?.x ?? PAD).toFixed(1)} ${HEIGHT - PAD} L ${(points[0]?.x ?? PAD).toFixed(1)} ${HEIGHT - PAD} Z`;

  return (
    <svg
      role="img"
      aria-label="Yozilishlar grafigi (30 kun)"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-32 w-full"
    >
      <defs>
        <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgb(0 113 227 / 0.3)" />
          <stop offset="100%" stopColor="rgb(0 113 227 / 0.02)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkline-gradient)" />
      <path
        d={linePath}
        className="fill-none stroke-blue"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p) => (
        <circle
          key={p.date}
          cx={p.x}
          cy={p.y}
          r={2.5}
          className="fill-blue"
        >
          <title>{`${p.date}: ${p.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Top 5 courses widget
// ──────────────────────────────────────────────────────────────────────

interface TopCoursesCardProps {
  locale: string;
  data: TeacherAnalyticsTopCourse[];
  isLoading: boolean;
  error: string | null;
}

function TopCoursesCard({
  locale,
  data,
  isLoading,
  error,
}: TopCoursesCardProps) {
  const max = useMemo(
    () => data.reduce((m, c) => (c.enrollments > m ? c.enrollments : m), 0) || 1,
    [data],
  );

  return (
    <section className="flex h-full flex-col rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-tint">
            <Trophy className="h-4.5 w-4.5 text-orange" />
          </div>
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-ink-strong">
              Eng mashhur kurslar
            </h2>
            <p className="text-xs text-ink-soft">Talabalar soni boʻyicha reyting</p>
          </div>
        </div>
        <Link
          href={`/${locale}/dashboard/courses`}
          className="group flex items-center gap-1 text-xs font-bold text-blue hover:text-blue-600"
        >
          Hammasi
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="mt-6 flex-1">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[100px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft">
            <GraduationCap className="mb-2 h-6 w-6 opacity-20" />
            Hozircha kurslar yoʻq
          </div>
        ) : (
          <ul className="divide-y divide-rim">
            {data.map((course, i) => (
              <li key={course.courseId} className="group flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint font-mono text-[11px] font-bold text-ink-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/${locale}/dashboard/courses/${course.courseId}`}
                      className="truncate text-xs font-bold text-ink-strong transition-colors hover:text-blue"
                    >
                      {course.title}
                    </Link>
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold">
                      <span className="text-ink-strong">{course.enrollments}</span>
                      <span className="text-ink-faint">talaba</span>
                      {!course.isPublished && (
                        <span className="ml-1.5 rounded-full bg-tint px-1.5 py-0.5 text-[8px] text-ink-soft uppercase tracking-wider border border-rim">
                          Qoralama
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-tint">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-blue transition-all duration-1000 ease-out"
                      style={{
                        width: `${Math.max(4, (course.enrollments / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Homework status donut
// ──────────────────────────────────────────────────────────────────────

interface HomeworkDonutCardProps {
  data: TeacherAnalyticsHomeworkStats | undefined;
  isLoading: boolean;
  error: string | null;
}

const HOMEWORK_LABELS: Record<TeacherHomeworkStatusKey, string> = {
  DRAFT: 'Qoralama',
  SUBMITTED: 'Yuborilgan',
  IN_REVIEW: 'Koʻrib chiqilmoqda',
  GRADED: 'Baholangan',
  RETURNED: 'Qaytarilgan',
};

const HOMEWORK_COLORS: Record<TeacherHomeworkStatusKey, string> = {
  DRAFT: '#AEAEB2',
  SUBMITTED: '#0071E3',
  IN_REVIEW: '#FF9F0A',
  GRADED: '#34C759',
  RETURNED: '#FF3B30',
};

function HomeworkDonutCard({
  data,
  isLoading,
  error,
}: HomeworkDonutCardProps) {
  const segments = useMemo(() => {
    if (!data) return [];
    return TEACHER_HOMEWORK_STATUSES.map((key) => ({
      key,
      label: HOMEWORK_LABELS[key],
      color: HOMEWORK_COLORS[key],
      value: data[key] ?? 0,
    }));
  }, [data]);
  const total = useMemo(
    () => segments.reduce((sum, seg) => sum + seg.value, 0),
    [segments],
  );

  return (
    <section className="flex h-full flex-col rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-tint">
            <Layers className="h-4.5 w-4.5 text-purple" />
          </div>
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-ink-strong">
              Uy ishlari
            </h2>
            <p className="text-xs text-ink-soft">Vazifalar holati boʻyicha</p>
          </div>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {isLoading ? (
        <div className="mt-6 flex flex-1 items-center gap-6">
          <Skeleton className="h-28 w-28 rounded-full" />
          <div className="flex-1 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <div className="mt-6 flex flex-1 min-h-[140px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft">
          <CheckCircle2 className="mb-2 h-6 w-6 opacity-20" />
          Hali topshiriqlar yoʻq
        </div>
      ) : (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-6 sm:flex-row">
          <div className="relative">
            <Donut segments={segments} total={total} />
          </div>
          <ul className="grid flex-1 grid-cols-1 gap-x-4 gap-y-2">
            {segments.map((seg) => (
              <li
                key={seg.key}
                className="flex items-center justify-between gap-3 text-xs font-medium"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full shadow-sm"
                    style={{ background: seg.color }}
                  />
                  <span className="text-ink-strong">{seg.label}</span>
                </div>
                <span className="font-mono text-ink-soft">{seg.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface DonutProps {
  segments: Array<{
    key: TeacherHomeworkStatusKey;
    label: string;
    color: string;
    value: number;
  }>;
  total: number;
}

function Donut({ segments, total }: DonutProps) {
  const SIZE = 140;
  const STROKE = 22;
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = segments
    .filter((seg) => seg.value > 0)
    .map((seg) => {
      const length = (seg.value / total) * circumference;
      const arc = (
        <circle
          key={seg.key}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="none"
          stroke={seg.color}
          strokeWidth={STROKE}
          strokeDasharray={`${length} ${circumference - length}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        >
          <title>{`${seg.label}: ${seg.value}`}</title>
        </circle>
      );
      offset += length;
      return arc;
    });

  return (
    <svg
      role="img"
      aria-label="Uy ishlari holati grafigi"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-32 w-32"
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        className="stroke-soft"
        strokeWidth={STROKE}
      />
      {arcs}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-ink-strong"
        fontSize={20}
        fontWeight={700}
      >
        {total}
      </text>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Quick actions row
// ──────────────────────────────────────────────────────────────────────

function QuickActions({ locale }: { locale: string }) {
  const actions = [
    {
      href: `/${locale}/dashboard/courses`,
      title: 'Kurslar',
      description: 'Boshqarish',
      icon: BookOpen,
      color: 'text-blue',
      bgColor: 'bg-blue-tint',
    },
    {
      href: `/${locale}/groups`,
      title: 'Guruhlar',
      description: 'Talabalar',
      icon: Users,
      color: 'text-teal',
      bgColor: 'bg-teal-tint',
    },
    {
      href: `/${locale}/homework`,
      title: 'Uy ishlari',
      description: 'Baholash',
      icon: Layers,
      color: 'text-purple',
      bgColor: 'bg-purple-tint',
    },
    {
      href: `/${locale}/teacher/analytics`,
      title: 'Analitika',
      description: 'Hisobotlar',
      icon: LayoutDashboard,
      color: 'text-orange',
      bgColor: 'bg-orange-tint',
    },
  ];

  return (
    <section className="h-full rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
      <h2 className="text-base font-extrabold tracking-tight text-ink-strong">
        Tezkor amallar
      </h2>
      <div className="mt-6 flex flex-col gap-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex items-center gap-3 rounded-2xl border border-rim bg-tint p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-medium hover:bg-canvas hover:border-blue/20"
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${action.bgColor} ${action.color}`}>
              <action.icon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-ink-strong group-hover:text-blue transition-colors">
                {action.title}
              </div>
              <div className="truncate text-[10px] font-medium text-ink-soft">
                {action.description}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-xl border border-red/20 bg-red-tint px-4 py-2 text-sm text-red">
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
