'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  CheckCircle,
  Settings,
  Edit3,
  DollarSign,
  ExternalLink,
  Lightbulb,
  ChevronRight,
  Clock,
  AlertCircle,
  BarChart3,
  Sparkles,
  TrendingUp
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
import { teacherApi } from '../../lib/api/teacher';
import { tokens } from '../../lib/design/tokens';

interface TeacherDashboardProps {
  locale: string;
}

export function TeacherDashboard({ locale }: TeacherDashboardProps) {
  const router = useRouter();
  const [user, setUser] = useState<DecodedToken | null>(null);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  // ADMIN also renders this dashboard but has no TeacherProfile — the
  // `/teacher/*` endpoints 403 for them, so only ever query as TEACHER.
  const isTeacher = user?.role === 'TEACHER';

  const profileQuery = useQuery({
    queryKey: ['teacher', 'profile', 'me'],
    queryFn: () => teacherApi.getMyProfile(),
    enabled: isTeacher,
  });

  // First-time (or not-yet-finished) teachers have no `publicSlug` yet, i.e.
  // no live public profile ("website"). Send them straight into the
  // onboarding wizard instead of an empty dashboard (Req: everything needed
  // to launch the site must surface on first login).
  const needsProfileSetup =
    isTeacher &&
    profileQuery.isSuccess &&
    !profileQuery.data.teacherProfile?.publicSlug;

  useEffect(() => {
    if (needsProfileSetup) {
      router.replace(`/${locale}/onboarding`);
    }
  }, [needsProfileSetup, router, locale]);

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
  const revenueTrendQuery = useQuery({
    queryKey: ['teacher', 'analytics', 'revenue-trend', 30],
    queryFn: () => teacherAnalyticsApi.revenueTrend(30),
  });

  // Avoid flashing the (empty) dashboard while we check profile completion
  // or while the redirect to `/onboarding` is in flight.
  if (isTeacher && (profileQuery.isLoading || needsProfileSetup)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue border-t-transparent" />
      </div>
    );
  }

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

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueTrendCard
            data={revenueTrendQuery.data ?? []}
            isLoading={revenueTrendQuery.isLoading}
            error={errorMessage(revenueTrendQuery.error)}
          />
        </div>
        <BilgimAiCard locale={locale} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
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

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TeacherChecklist
            locale={locale}
            hasPublicProfile={!!profileQuery.data?.teacherProfile?.publicSlug}
            hasPublishedCourse={(overviewQuery.data?.publishedCourses ?? 0) > 0}
          />
        </div>
        <div>
          <TeacherTips />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
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
        color: 'text-green',
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
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-blue-soft hover:border-blue/30 animate-in fade-in slide-in-from-bottom-4"
            style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'both' }}
          >
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-transparent to-black/[0.02] transition-all duration-500 group-hover:scale-150 group-hover:to-blue/[0.05]" />
            <div className="relative flex items-center justify-between">
              <div
                className={`rounded-2xl p-2.5 ${
                  kpi.color === 'text-green'
                    ? 'bg-green-tint'
                    : kpi.color === 'text-purple'
                      ? 'bg-purple-tint'
                      : kpi.color === 'text-orange'
                        ? 'bg-orange-tint'
                        : 'bg-blue-tint'
                }`}
              >
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                {kpi.label}
              </div>
            </div>
            
            <div className="relative mt-4">
              {kpi.value === null ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <div className="font-display text-xl font-extrabold tracking-tight text-ink-strong transition-transform group-hover:scale-[1.02] origin-left">
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
    <section className="group rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
            Yangi yozilishlar
          </h2>
          <p className="text-xs text-ink-soft">Oxirgi 30 kunlik dinamika</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xl font-bold text-blue transition-transform group-hover:scale-110 origin-right">{total}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
            Jami talaba
          </span>
        </div>
      </div>
      
      {error ? <ErrorBanner message={error} /> : null}
      
      <div className="mt-6 min-h-[140px]">
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
// Revenue trend (real /teacher/analytics/revenue-trend)
// ──────────────────────────────────────────────────────────────────────

interface RevenueTrendCardProps {
  data: TeacherAnalyticsTrendPoint[];
  isLoading: boolean;
  error: string | null;
}

function RevenueTrendCard({ data, isLoading, error }: RevenueTrendCardProps) {
  const total = useMemo(
    () => data.reduce((sum, p) => sum + p.value, 0),
    [data],
  );

  return (
    <section className="group h-full rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
            Tushum dinamikasi
          </h2>
          <p className="text-xs text-ink-soft">Oxirgi 30 kun · UZS</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-display text-xl font-extrabold text-ink-strong">
            {formatUzs(total)}{' '}
            <span className="text-sm font-bold text-ink-soft">soʻm</span>
          </span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-green">
            <TrendingUp className="h-3 w-3" /> Jami daromad
          </span>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="mt-6 min-h-[160px]">
        {isLoading ? (
          <div className="flex h-[140px] items-end gap-1.5">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="flex-1 animate-pulse rounded-full bg-tint"
                style={{ height: `${Math.random() * 60 + 20}%` }}
              />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[140px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft">
            <CreditCard className="mb-2 h-6 w-6 opacity-20" />
            Hozircha toʻlovlar yoʻq
          </div>
        ) : (
          <RevenueArea data={data} />
        )}
      </div>
    </section>
  );
}

function RevenueArea({ data }: { data: TeacherAnalyticsTrendPoint[] }) {
  const WIDTH = 720;
  const HEIGHT = 180;
  const PAD = 6;
  const max = Math.max(1, ...data.map((p) => p.value));
  const stepX = data.length > 1 ? (WIDTH - PAD * 2) / (data.length - 1) : 0;
  const points = data.map((p, i) => {
    const x = PAD + i * stepX;
    const y = HEIGHT - PAD - (p.value / max) * (HEIGHT - PAD * 2);
    return { x, y, ...p };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L ${(last?.x ?? PAD).toFixed(1)} ${HEIGHT - PAD} L ${(first?.x ?? PAD).toFixed(1)} ${HEIGHT - PAD} Z`;

  return (
    <svg
      role="img"
      aria-label="Tushum grafigi (30 kun)"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-44 w-full"
    >
      <defs>
        <linearGradient id="revenue-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgb(0 113 227 / 0.22)" />
          <stop offset="100%" stopColor="rgb(0 113 227 / 0.02)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#revenue-gradient)" />
      <path
        d={linePath}
        className="fill-none stroke-blue"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={4}
          className="fill-blue stroke-white"
          strokeWidth={2.5}
        />
      ) : null}
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BilgimAI promo
// ──────────────────────────────────────────────────────────────────────

function BilgimAiCard({ locale }: { locale: string }) {
  return (
    <section
      className="group relative h-full overflow-hidden rounded-3xl p-6 text-white shadow-soft transition-all duration-300 hover:shadow-medium animate-in fade-in slide-in-from-bottom-6"
      style={{ background: `linear-gradient(135deg, ${tokens.ai.accent} 0%, #8C2BBA 100%)` }}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl transition-all group-hover:bg-white/25" />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="font-display text-lg font-extrabold tracking-tight">
            BilgimAI
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/85">
          Uy vazifalarni AI bilan tezroq tekshiring va talabalarga aniq
          fikr-mulohaza bering.
        </p>
        <div className="mt-auto pt-5">
          <Link
            href={`/${locale}/ai-chat`}
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-purple transition-all hover:bg-white/90 active:scale-[0.98]"
          >
            Ochish
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
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
    <section className="group rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
            Eng mashhur kurslar
          </h2>
          <p className="text-xs text-ink-soft">Talabalar soni boʻyicha reyting</p>
        </div>
        <Link
          href={`/${locale}/dashboard/courses`}
          className="flex items-center gap-1 text-xs font-bold text-blue hover:text-blue-600 group-hover:bg-blue/5 rounded-full px-3 py-1 transition-all"
        >
          Hammasi
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
      
      {error ? <ErrorBanner message={error} /> : null}
      
      <div className="mt-6">
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
          <div className="flex h-[100px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft transition-transform hover:scale-105">
            <GraduationCap className="mb-2 h-6 w-6 opacity-20 animate-float" />
            Hozircha kurslar yoʻq
          </div>
        ) : (
          <ul className="space-y-4">
            {data.map((course) => (
              <li key={course.courseId} className="group space-y-1.5">
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
  DRAFT: tokens.text.faint,
  SUBMITTED: tokens.brand.primary,
  IN_REVIEW: tokens.semantic.warn,
  GRADED: tokens.semantic.success,
  RETURNED: tokens.semantic.danger,
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
    <section className="group rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
            Uy ishlari
          </h2>
          <p className="text-xs text-ink-soft">Vazifalar holati boʻyicha</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint transition-colors group-hover:bg-blue/5 group-hover:text-blue">
          <Layers className="h-4.5 w-4.5 text-ink-soft transition-transform group-hover:scale-110" />
        </div>
      </div>
      
      {error ? <ErrorBanner message={error} /> : null}
      
      {isLoading ? (
        <div className="mt-6 flex items-center gap-6">
          <Skeleton className="h-28 w-28 rounded-full" />
          <div className="flex-1 space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <div className="mt-6 flex h-[140px] flex-col items-center justify-center rounded-2xl bg-tint text-xs text-ink-soft transition-transform hover:scale-105">
          <CheckCircle2 className="mb-2 h-6 w-6 opacity-20 animate-float" />
          Hali topshiriqlar yoʻq
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
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
      color: 'text-green',
      bgColor: 'bg-green-tint',
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
    <section className="h-full rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '500ms', animationFillMode: 'both' }}>
      <h2 className="text-base font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
        Tezkor amallar
      </h2>
      <div className="mt-6 flex flex-col gap-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex items-center gap-3 rounded-2xl border border-rim bg-tint p-3.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-blue-soft hover:bg-canvas hover:border-blue/30"
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${action.bgColor} ${action.color} transition-colors duration-300 group-hover:bg-blue group-hover:text-white`}>
              <action.icon className="h-4.5 w-4.5 transition-transform duration-300 group-hover:scale-110" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-ink-strong group-hover:text-blue transition-colors">
                {action.title}
              </div>
              <div className="truncate text-[10px] font-medium text-ink-soft group-hover:text-ink-strong transition-colors">
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

// ──────────────────────────────────────────────────────────────────────
// Onboarding Checklist
// ──────────────────────────────────────────────────────────────────────

function TeacherChecklist({
  locale,
  hasPublicProfile,
  hasPublishedCourse,
}: {
  locale: string;
  hasPublicProfile: boolean;
  hasPublishedCourse: boolean;
}) {
  const steps = [
    {
      id: 'brand',
      title: 'Ommaviy profilni sozlash',
      description: "Sayt manzili, sarlavha va bio — bilgim.uz/teachers/... orqali topiladi.",
      icon: Settings,
      isCompleted: hasPublicProfile,
      href: `/${locale}/onboarding`,
    },
    {
      id: 'curriculum',
      title: 'Kurs yaratish va nashr qilish',
      description: 'Darslar va modullarni rejalashtiring, keyin nashr qiling.',
      icon: Edit3,
      isCompleted: hasPublishedCourse,
      href: `/${locale}/dashboard/courses/new`,
    },
    {
      id: 'pricing',
      title: 'Toʻlovlarni sozlash',
      description: 'Obuna va narxlarni belgilang (Start earning).',
      icon: DollarSign,
      isCompleted: false,
      href: `/${locale}/settings/billing`,
    },
  ];

  const completedCount = steps.filter((s) => s.isCompleted).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8 transition-all duration-300 hover:shadow-medium hover:border-blue/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '600ms', animationFillMode: 'both' }}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-extrabold text-ink-strong">
            Sizning qadamlaringiz
          </h2>
          <p className="text-sm text-ink-soft">Tizimni toʻliq ishga tushirish uchun vazifalar</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Bajarildi
            </div>
            <div className="font-mono text-sm font-bold text-ink-strong">{progress}%</div>
          </div>
          <div className="relative h-10 w-10 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <path
                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                className="text-tint"
              />
              <path
                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray={`${progress}, 100`}
                className="text-blue transition-all duration-1000 ease-out"
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {steps.map((step, i) => (
          <Link
            key={step.id}
            href={step.href}
            className={`group flex items-start gap-4 rounded-2xl border p-4 transition-all duration-300 hover:shadow-sm hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-4 ${
              step.isCompleted
                ? 'border-green/20 bg-green/5 hover:border-green/30'
                : 'border-rim bg-white hover:border-blue/30 hover:bg-blue/5'
            }`}
            style={{ animationDelay: `${700 + (i * 100)}ms`, animationFillMode: 'both' }}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                step.isCompleted ? 'bg-green text-white' : 'bg-tint text-ink-faint group-hover:bg-blue group-hover:text-white'
              }`}
            >
              {step.isCompleted ? (
                <CheckCircle className="h-4.5 w-4.5" />
              ) : (
                <step.icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
              )}
            </div>
            <div className="flex-1">
              <h3
                className={`text-sm font-bold transition-colors ${
                  step.isCompleted ? 'text-green' : 'text-ink-strong group-hover:text-blue'
                }`}
              >
                {step.title}
              </h3>
              <p className="mt-1 text-xs text-ink-soft transition-colors group-hover:text-ink-strong">{step.description}</p>
            </div>
            <ChevronRight
              className={`mt-1 h-4 w-4 shrink-0 transition-all duration-300 group-hover:translate-x-1 ${
                step.isCompleted ? 'text-green/50' : 'text-ink-faint group-hover:text-blue'
              }`}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tips & Resources
// ──────────────────────────────────────────────────────────────────────

function TeacherTips() {
  const tips = [
    {
      title: 'Talabalarni qanday koʻpaytirish mumkin?',
      duration: '3 min oʻqish',
    },
    {
      title: 'Video darslarni sifatli yozish sirlari',
      duration: '5 min oʻqish',
    },
    {
      title: 'Gamifikatsiyadan unumli foydalanish',
      duration: '4 min oʻqish',
    },
  ];

  return (
    <section className="h-full rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-orange/20 animate-in fade-in slide-in-from-bottom-6" style={{ animationDelay: '700ms', animationFillMode: 'both' }}>
      <div className="flex items-center gap-2 text-ink-strong group">
        <Lightbulb className="h-5 w-5 text-orange transition-transform duration-300 group-hover:scale-110 animate-pulse-glow" />
        <h2 className="text-base font-extrabold tracking-tight transition-colors group-hover:text-orange">Maslahatlar</h2>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Bilgim tizimidan 100% samarali foydalanish uchun qoʻllanmalar
      </p>

      <ul className="mt-6 space-y-4">
        {tips.map((tip, i) => (
          <li key={i}>
            <a
              href="#"
              className="group block rounded-2xl border border-rim bg-white p-4 transition-all duration-300 hover:-translate-y-1 hover:border-orange/40 hover:shadow-md animate-in fade-in slide-in-from-bottom-4"
              style={{ animationDelay: `${800 + (i * 100)}ms`, animationFillMode: 'both' }}
            >
              <h3 className="text-xs font-bold leading-tight text-ink-strong transition-colors group-hover:text-orange">
                {tip.title}
              </h3>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] font-medium text-ink-faint transition-colors group-hover:text-ink-soft">
                  {tip.duration}
                </span>
                <ExternalLink className="h-3 w-3 text-ink-faint transition-all duration-300 group-hover:text-orange group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
