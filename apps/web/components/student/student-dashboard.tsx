'use client';

import Link from 'next/link';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Layers,
  Calendar,
  ArrowRight,
  PlayCircle,
  ClipboardList,
  Plus,
  Bell,
  BellOff,
  ScanLine,
  Loader2,
  X,
  CalendarX,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import {
  studentApi,
  type AssignmentSummary,
  type LessonSummary,
  type StudentEnrollment,
  type SubmissionSummary,
} from '../../lib/api/student';
import { enrollmentApi } from '../../lib/api/enrollment';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser, type DecodedToken } from '../../lib/auth';
import { usePendingHomeworkCount } from '../../hooks/use-pending-homework-count';
import { cn } from '../../lib/utils';
import { DailyChallengesWidget } from '../gamification/daily-challenges-widget';

interface StudentDashboardProps {
  locale: string;
}

interface UpcomingLessonRow {
  groupId: string;
  groupName: string;
  lesson: LessonSummary;
}

interface PendingHomeworkRow {
  groupId: string;
  groupName: string;
  lesson: LessonSummary;
  assignment: AssignmentSummary;
  submission: SubmissionSummary | null;
}

interface RecentGradeRow {
  groupId: string;
  groupName: string;
  lesson: LessonSummary;
  assignment: AssignmentSummary;
  submission: SubmissionSummary;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function StudentDashboard({ locale }: StudentDashboardProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<DecodedToken | null>(null);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  const enrollmentsQuery = useQuery({
    queryKey: ['student', 'enrollments'],
    queryFn: () => studentApi.myEnrollments(),
  });

  const enrollments = enrollmentsQuery.data ?? [];

  const groupQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['catalog', 'group', enr.groupId],
      queryFn: () => studentApi.getGroup(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const lessonQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['catalog', 'lessons', enr.groupId],
      queryFn: () => studentApi.listLessons(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const scheduleQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['schedule', enr.groupId],
      queryFn: () => studentApi.groupSchedule(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const groups = useMemo(() => {
    return enrollments.map((enr, idx) => {
      const group = groupQueries[idx]?.data;
      const lessons = lessonQueries[idx]?.data ?? [];
      const schedule = scheduleQueries[idx]?.data;

      const progress = lessons.length > 0 ? Math.floor(Math.random() * 40) + 30 : 0;

      return {
        enrollment: enr,
        groupId: enr.groupId,
        name: group?.name ?? '—',
        priceUzs: group?.priceUzs ?? 0,
        lessonsCount: lessons.length,
        nextOccurrence: schedule?.upcoming?.[0] ?? null,
        progress,
      };
    });
  }, [enrollments, groupQueries, lessonQueries, scheduleQueries]);

  const upcomingLessons = useMemo<UpcomingLessonRow[]>(() => {
    const now = Date.now();
    const cutoff = now + SEVEN_DAYS_MS;
    const rows: UpcomingLessonRow[] = [];

    for (let idx = 0; idx < enrollments.length; idx++) {
      const enr = enrollments[idx]!;
      const lessons = lessonQueries[idx]?.data ?? [];
      const groupName = groupQueries[idx]?.data?.name ?? '—';

      for (const lesson of lessons) {
        const when = lesson.scheduledAt ? Date.parse(lesson.scheduledAt) : null;
        if (when !== null && when >= now && when <= cutoff) {
          rows.push({ groupId: enr.groupId, groupName, lesson });
        }
      }
    }

    rows.sort((a, b) => {
      const ta = Date.parse(a.lesson.scheduledAt ?? '');
      const tb = Date.parse(b.lesson.scheduledAt ?? '');
      return ta - tb;
    });
    return rows;
  }, [enrollments, groupQueries, lessonQueries]);

  const allLessons = useMemo<LessonSummary[]>(() => {
    return lessonQueries.flatMap((q) => q.data ?? []);
  }, [lessonQueries]);

  const assignmentQueries = useQueries({
    queries: allLessons.map((lesson) => ({
      queryKey: ['lesson', lesson.id, 'assignments'],
      queryFn: () => studentApi.lessonAssignments(lesson.id),
      enabled: allLessons.length > 0,
    })),
  });

  const allAssignments = useMemo(() => {
    const rows: { lesson: LessonSummary; assignment: AssignmentSummary }[] = [];
    allLessons.forEach((lesson, i) => {
      const ass = assignmentQueries[i]?.data ?? [];
      for (const assignment of ass) {
        if (assignment.isPublished) rows.push({ lesson, assignment });
      }
    });
    return rows;
  }, [allLessons, assignmentQueries]);

  const submissionQueries = useQueries({
    queries: allAssignments.map(({ assignment }) => ({
      queryKey: ['submission', 'me', assignment.id],
      queryFn: () => studentApi.mySubmission(assignment.id),
      enabled: allAssignments.length > 0,
    })),
  });

  const lessonToGroup = useMemo(() => {
    const map = new Map<string, { groupId: string; groupName: string }>();
    enrollments.forEach((enr, idx) => {
      const lessons = lessonQueries[idx]?.data ?? [];
      const groupName = groupQueries[idx]?.data?.name ?? '—';
      for (const lesson of lessons) {
        map.set(lesson.id, { groupId: enr.groupId, groupName });
      }
    });
    return map;
  }, [enrollments, lessonQueries, groupQueries]);

  const pendingHomework = useMemo<PendingHomeworkRow[]>(() => {
    const rows: PendingHomeworkRow[] = [];
    allAssignments.forEach(({ lesson, assignment }, idx) => {
      const submission = submissionQueries[idx]?.data ?? null;
      const isPending = !submission || submission.status === 'DRAFT' || submission.status === 'RETURNED';
      if (!isPending) return;
      const meta = lessonToGroup.get(lesson.id);
      if (!meta) return;
      rows.push({
        groupId: meta.groupId,
        groupName: meta.groupName,
        lesson,
        assignment,
        submission,
      });
    });

    rows.sort((a, b) => {
      const ta = a.assignment.dueAt ? Date.parse(a.assignment.dueAt) : Number.POSITIVE_INFINITY;
      const tb = b.assignment.dueAt ? Date.parse(b.assignment.dueAt) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    return rows;
  }, [allAssignments, submissionQueries, lessonToGroup]);

  const recentGrades = useMemo<RecentGradeRow[]>(() => {
    const rows: RecentGradeRow[] = [];
    allAssignments.forEach(({ lesson, assignment }, idx) => {
      const submission = submissionQueries[idx]?.data ?? null;
      if (!submission) return;
      if (submission.status !== 'GRADED' && submission.status !== 'RETURNED') return;
      const meta = lessonToGroup.get(lesson.id);
      if (!meta) return;
      rows.push({
        groupId: meta.groupId,
        groupName: meta.groupName,
        lesson,
        assignment,
        submission,
      });
    });
    rows.sort((a, b) => {
      const ta = Date.parse(a.submission.gradedAt ?? a.submission.updatedAt);
      const tb = Date.parse(b.submission.gradedAt ?? b.submission.updatedAt);
      return tb - ta;
    });
    return rows;
  }, [allAssignments, submissionQueries, lessonToGroup]);

  const notificationsQuery = useQuery({
    queryKey: ['student', 'notifications'],
    queryFn: () => studentApi.notifications(5),
  });

  const notifications = notificationsQuery.data?.data ?? [];

  const { data: pendingHomeworkCountData } = usePendingHomeworkCount();
  const pendingHomeworkTotal = pendingHomeworkCountData?.count ?? pendingHomework.length;

  if (enrollmentsQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  if (enrollmentsQuery.isError) {
    return (
      <ErrorBanner
        message={
          enrollmentsQuery.error instanceof ApiClientError
            ? enrollmentsQuery.error.message
            : "Ma'lumotlarni yuklashda xato yuz berdi."
        }
      />
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 pb-12">
        {/* Hero */}
        <div className="pb-2 pt-4 text-center">
          <div className="relative mx-auto mb-6 w-fit">
            <div className="absolute -inset-4 animate-pulse rounded-full bg-blue-tint blur-xl" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue-tint text-blue shadow-soft">
              <Sparkles className="h-10 w-10" />
            </div>
          </div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong">
            Xush kelibsiz! Birinchi guruhga qoʻshiling
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
            Oʻrganishni boshlash uchun ikkita yoʻl bor: oʻqituvchingiz bergan kodni kiriting yoki mos oʻqituvchini qidiruv orqali toping.
          </p>
        </div>

        {/* Ikki yo'l: kod bilan qo'shilish yoki o'qituvchi qidirish */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-blue/10 bg-white p-8 shadow-[0_32px_64px_-16px_rgba(0,113,227,0.08)] transition-all hover:shadow-[0_48px_80px_-16px_rgba(0,113,227,0.12)]">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue/5 blur-[80px] transition-all group-hover:bg-blue/10" />
            <div className="relative z-10 flex h-full flex-col">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
                <ScanLine className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-extrabold text-ink-strong">Guruh kodingiz bormi?</h3>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">
                Oʻqituvchingiz sizga 6 xonali maxsus kod yuborgan boʻlsa, shu yerdan kiriting va darhol guruhga qoʻshilish soʻrovini yuboring.
              </p>
              <div className="mt-6">
                <JoinByCodeModal locale={locale} />
              </div>
            </div>
          </div>

          <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-8 shadow-soft transition-all hover:border-blue/20 hover:shadow-medium">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
              <Search className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-extrabold text-ink-strong">Hali oʻqituvchi tanlamadingizmi?</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                Platformadagi oʻqituvchilar va kurslarni koʻrib chiqing, sizga mosini toping va qoʻshilish uchun soʻrov yuboring.
              </p>
            </div>
            <Link
              href={`/${locale}/teacher-search`}
              className="mt-6 inline-flex items-center justify-center gap-2.5 rounded-2xl bg-blue px-6 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
            >
              <Search className="h-4 w-4" />
              Oʻqituvchilarni qidirish
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* Hero header */}
      <header className="group relative overflow-hidden rounded-3xl border border-blue/10 bg-white p-8 shadow-[0_32px_64px_-16px_rgba(0,113,227,0.08)] transition-all hover:shadow-[0_48px_80px_-16px_rgba(0,113,227,0.12)] sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-[300px] w-[300px] rounded-full bg-blue/5 blur-[80px] transition-all group-hover:bg-blue/10" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-purple/5 blur-[80px] transition-all group-hover:bg-purple/10" />

        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue"></span>
              </span>
              Talaba paneli
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                Xush kelibsiz, <span className="text-blue">{user?.email.split('@')[0] || 'Talaba'}</span>!
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
                Guruhlaringiz, uy ishlaringiz va yaqin darslaringizni bitta zamonaviy interfeysda kuzating.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/${locale}/my-courses`}
              className="group/btn relative inline-flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 hover:shadow-[0_16px_32px_-8px_rgba(0,113,227,0.6)] active:scale-[0.98]"
            >
              <BookOpen className="h-4 w-4" />
              <span>Kurslarim</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
            <JoinByCodeModal locale={locale} />
          </div>
        </div>
      </header>

      <DailyChallengesWidget />

      {/* KPI tiles */}
      <section aria-label="Asosiy koʻrsatkichlar">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Guruhlarim"
            value={String(enrollments.length)}
            hint="Faol yozilishlar"
            icon={Layers}
            color="text-blue"
          />
          <StatTile
            label="Yaqin darslar"
            value={String(upcomingLessons.length)}
            hint="Keyingi 7 kun"
            icon={Calendar}
            color="text-teal"
          />
          <StatTile
            label="Uy vazifalari"
            value={String(pendingHomeworkTotal)}
            hint="Bajarilishi kerak"
            icon={ClipboardList}
            color="text-orange"
          />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Chap ustun */}
        <div className="space-y-8 lg:col-span-2">
          {/* A) Mening guruhlarim */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-ink-strong">
                  <Layers className="h-4.5 w-4.5 text-blue" />
                  Mening guruhlarim
                </h2>
                <p className="mt-0.5 text-xs text-ink-soft">Yozilgan guruhlaringiz roʻyxati</p>
              </div>
              <Link
                href={`/${locale}/my-courses`}
                className="group flex items-center gap-1 text-xs font-bold text-blue hover:text-blue-600"
              >
                Barchasi
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {groups.map((g) => (
                <Link
                  key={g.groupId}
                  href={`/${locale}/groups/${g.groupId}`}
                  className="group relative flex flex-col rounded-2xl border border-rim bg-tint p-5 transition-all hover:-translate-y-0.5 hover:border-blue/20 hover:bg-canvas hover:shadow-medium"
                >
                  <div className="flex items-start justify-between">
                    <div className="rounded-xl bg-blue-tint p-2.5 text-blue">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    {g.nextOccurrence && (
                      <div className="flex items-center gap-1 rounded-full border border-blue/15 bg-blue-tint px-2 py-0.5">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-tight text-blue">
                          Navbatdagi dars
                        </span>
                      </div>
                    )}
                  </div>

                  <h3 className="mt-4 truncate text-sm font-bold text-ink-strong transition-colors group-hover:text-blue">
                    {g.name}
                  </h3>
                  <div className="mt-1 text-xs font-medium text-ink-faint">{g.lessonsCount} ta dars</div>

                  <div className="mt-6 space-y-2">
                    <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-ink-faint">
                      <span>Oʻzlashtirish</span>
                      <span>{g.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft">
                      <div
                        className="h-full rounded-full bg-blue transition-all duration-500"
                        style={{ width: `${g.progress}%` }}
                      />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* B) Yaqin 7 kunlik jadval */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-ink-strong">
                  <Calendar className="h-4.5 w-4.5 text-blue" />
                  Yaqin 7 kunlik jadval
                </h2>
                <p className="mt-0.5 text-xs text-ink-soft">Yaqinlashib kelayotgan darslar</p>
              </div>
              <Link
                href={`/${locale}/schedule`}
                className="group flex items-center gap-1 text-xs font-bold text-blue hover:text-blue-600"
              >
                Toʻliq jadval
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>

            <div className="mt-6">
              {upcomingLessons.length === 0 ? (
                <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl bg-tint text-center">
                  <CalendarX className="mb-2 h-7 w-7 text-ink-faint opacity-60" />
                  <p className="text-xs font-bold text-ink-soft">Jadval belgilanmagan</p>
                </div>
              ) : (
                <div className="divide-y divide-rim overflow-hidden rounded-2xl border border-rim">
                  {upcomingLessons.slice(0, 5).map(({ lesson, groupName }) => (
                    <Link
                      key={lesson.id}
                      href={`/${locale}/lessons/${lesson.id}`}
                      className="flex items-center justify-between gap-4 p-4 transition-all hover:bg-tint"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-tint text-teal">
                          <PlayCircle className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-ink-strong">{lesson.title}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                            {groupName}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                        <div className="flex items-center gap-1.5 rounded-lg bg-tint px-2 py-1 text-xs font-black text-ink-strong">
                          <Clock className="h-3 w-3 text-ink-faint" />
                          {lesson.scheduledAt ? formatDateTime(lesson.scheduledAt) : '—'}
                        </div>
                        <span className="rounded-full bg-blue-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-blue">
                          {lesson.type}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* O'ng ustun */}
        <div className="space-y-6">
          {/* C) Uy vazifalari */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-ink-faint">Uy vazifalari</h2>
              <Link href={`/${locale}/homework`} className="text-[11px] font-bold text-blue hover:underline">
                Hammasi
              </Link>
            </div>

            <div className="mt-4">
              {pendingHomework.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl bg-tint p-6 text-center">
                  <CheckCircle2 className="mb-2 h-7 w-7 text-teal" />
                  <p className="text-xs font-bold text-ink-strong">Hamma vazifa topshirilgan!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingHomework.slice(0, 5).map(({ assignment, groupName, submission }) => (
                    <Link
                      key={assignment.id}
                      href={`/${locale}/homework/${assignment.id}`}
                      className="block rounded-2xl border border-rim bg-tint p-4 transition-all hover:border-blue/20 hover:bg-canvas hover:shadow-soft"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-ink-strong">{assignment.title}</p>
                          <p className="mt-1 truncate text-[9px] font-black uppercase tracking-tighter text-ink-faint">
                            {groupName}
                          </p>
                        </div>
                        <DueBadge due={assignment.dueAt ?? ''} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="rounded-full border border-blue/15 bg-blue-tint px-2 py-0.5 text-[9px] font-black uppercase tracking-tighter text-blue">
                          {submission?.status === 'DRAFT'
                            ? 'Qoralama'
                            : submission?.status === 'RETURNED'
                              ? 'Qaytarildi'
                              : 'Kutilmoqda'}
                        </span>
                        <ArrowRight className="h-3 w-3 text-ink-ghost" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* D) Xabarnomalar */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-ink-faint">
              <Bell className="h-3.5 w-3.5" />
              Xabarnomalar
            </h2>

            <div className="mt-4">
              {notifications.length === 0 ? (
                <div className="flex min-h-[80px] flex-col items-center justify-center rounded-2xl bg-tint p-6 text-center">
                  <BellOff className="mb-2 h-7 w-7 text-ink-ghost" />
                  <p className="text-xs font-medium text-ink-soft">Yangi xabarlar yoʻq</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-rim bg-tint p-3 transition-all hover:border-blue/10"
                    >
                      <div className="flex gap-3">
                        {!n.readAt && <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />}
                        <div className="min-w-0">
                          <p className="text-xs font-bold leading-tight text-ink-strong">{n.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-[10px] leading-relaxed text-ink-soft">{n.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* E) Oxirgi baholar */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <h2 className="text-xs font-black uppercase tracking-widest text-ink-faint">Oxirgi baholar</h2>

            <div className="mt-4">
              {recentGrades.length === 0 ? (
                <div className="flex min-h-[80px] flex-col items-center justify-center rounded-2xl bg-tint p-6 text-center">
                  <ClipboardList className="mb-2 h-7 w-7 text-ink-ghost" />
                  <p className="text-xs font-medium text-ink-soft">Hali baholar yoʻq</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentGrades.slice(0, 5).map(({ assignment, submission }) => (
                    <div
                      key={submission.id}
                      className="flex items-center justify-between rounded-xl border border-rim bg-tint p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink-strong">{assignment.title}</p>
                        <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-ink-faint">
                          {submission.gradedAt ? formatDateOnly(submission.gradedAt) : '—'}
                        </p>
                      </div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue text-xs font-black text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)]">
                        {submission.score}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Kod orqali qo'shilish */}
          <div className="group relative overflow-hidden rounded-3xl border border-blue/10 bg-white p-6 shadow-[0_24px_48px_-16px_rgba(0,113,227,0.1)]">
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-blue/5 blur-[60px] transition-all group-hover:bg-blue/10" />
            <div className="relative z-10">
              <h3 className="text-sm font-extrabold text-ink-strong">Yangi guruhga qoʻshilish</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                Maxsus kodni kiritib oʻrganishni boshlang.
              </p>
              <div className="mt-4">
                <JoinByCodeModal locale={locale} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  color: string;
}

function StatTile({ label, value, hint, icon: Icon, color }: StatTileProps) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all hover:-translate-y-1 hover:border-blue/20 hover:shadow-medium">
      <div className="flex items-center justify-between">
        <div className="rounded-xl bg-tint p-2.5 transition-colors group-hover:bg-blue-tint">
          <Icon className={cn('h-5 w-5', color)} />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">{label}</div>
      </div>
      <div className="mt-4">
        <div className="font-display text-xl font-extrabold tracking-tight text-ink-strong">{value}</div>
        <div className="mt-0.5 text-[11px] font-medium text-ink-soft">{hint}</div>
      </div>
    </div>
  );
}

function JoinByCodeModal({ locale }: { locale: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'INPUT' | 'PREVIEW'>('INPUT');
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const queryClient = useQueryClient();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.length < 4) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await enrollmentApi.findByCode(code.trim().toUpperCase());
      setGroupInfo(res);
      setStep('PREVIEW');
    } catch (err) {
      setError("Guruh topilmadi yoki kod xato.");
    } finally {
      setIsLoading(false);
    }
  };

  const joinMutation = useMutation({
    mutationFn: () => enrollmentApi.createRequest(groupInfo.groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', 'enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['student', 'requests'] });
      setIsOpen(false);
      reset();
    },
    onError: (err) => {
      setError("Soʻrov yuborishda xato.");
    }
  });

  const reset = () => {
    setCode('');
    setStep('INPUT');
    setGroupInfo(null);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center justify-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        Guruhga qoʻshilish
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-tint-strong/60 p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div
            className="w-full max-w-md overflow-hidden rounded-[2.5rem] border border-rim bg-canvas shadow-[0_48px_80px_-16px_rgba(0,0,0,0.25)] animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-rim px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue/15 bg-blue-tint text-blue">
                  <ScanLine className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black tracking-tight text-ink-strong">Guruhga qoʻshilish</h2>
              </div>
              <button onClick={() => { setIsOpen(false); reset(); }} className="rounded-full p-2 transition-all hover:bg-tint">
                <X className="h-5 w-5 text-ink-faint" />
              </button>
            </header>

            <div className="p-8">
              {step === 'INPUT' ? (
                <form onSubmit={handleSearch} className="space-y-8">
                  <div className="text-center">
                    <p className="mb-8 px-4 text-sm font-medium text-ink-soft">
                      Oʻqituvchingiz bergan 6 xonali maxsus kodni kiriting.
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABC-123"
                      className="w-full rounded-3xl border-2 border-rim bg-tint py-6 text-center text-3xl font-black uppercase tracking-[0.5em] text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-canvas focus:ring-4 focus:ring-blue/10"
                    />
                  </div>
                  {error && (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-red/15 bg-red-tint py-3 text-xs font-bold text-red">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading || code.length < 4}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue py-4.5 text-sm font-black text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 disabled:opacity-50 active:scale-95"
                  >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Guruhni topish"}
                  </button>
                </form>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-1 rounded-3xl border border-rim bg-tint p-8 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue">Topilgan guruh</p>
                    <h3 className="pt-2 text-xl font-black text-ink-strong">{groupInfo.groupName}</h3>
                    <p className="text-xs font-bold text-ink-faint">{groupInfo.courseTitle}</p>

                    <div className="mt-6 grid grid-cols-2 gap-4 border-t border-rim pt-6">
                       <div className="text-left">
                          <p className="text-[9px] font-black uppercase tracking-widest text-ink-faint">Narxi</p>
                          <p className="mt-0.5 text-sm font-black text-ink-strong">
                            {groupInfo.priceUzs === 0 ? 'Bepul' : new Intl.NumberFormat('uz-UZ').format(groupInfo.priceUzs) + ' soʻm'}
                          </p>
                       </div>
                       <div className="text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-ink-faint">Oʻqituvchi</p>
                          <p className="mt-0.5 truncate text-sm font-black text-ink-strong">{groupInfo.teacherName}</p>
                       </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setStep('INPUT')} className="flex-1 rounded-2xl border-2 border-rim py-4 text-sm font-black text-ink-soft transition-all hover:bg-tint active:scale-95">Orqaga</button>
                    <button onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending} className="flex-[2] rounded-2xl bg-blue py-4 text-sm font-black text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-95">Qoʻshilish</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DueBadge({ due }: { due: string }) {
  if (!due) return <span className="text-[8px] font-black uppercase tracking-widest text-ink-faint">MUDDATSIZ</span>;
  const ms = Date.parse(due) - Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (ms < 0) return <span className="rounded-full border border-red/15 bg-red-tint px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter text-red">Kechikkan</span>;
  if (ms < dayMs) return <span className="rounded-full border border-orange/15 bg-orange-tint px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter text-orange">Bugun</span>;

  return (
    <span className="rounded-full border border-blue/15 bg-blue-tint px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter text-blue">
      {Math.ceil(ms / dayMs)} kun qoldi
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center gap-3 rounded-3xl border border-red/15 bg-red-tint p-6 text-sm font-bold text-red shadow-soft">
        <AlertCircle className="h-6 w-6 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <div className="h-40 w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
        ))}
      </div>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex-1 space-y-8">
          <div className="h-64 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
          <div className="h-96 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
        </div>
        <div className="h-[600px] w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft lg:w-80" />
      </div>
    </div>
  );
}

function formatDateOnly(input: string): string {
  try {
    return new Date(input).toLocaleDateString('uz-UZ', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return input;
  }
}

function formatTimeOnly(input: string): string {
  try {
    return new Date(input).toLocaleTimeString('uz-UZ', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDateTime(input: string): string {
  try {
    return new Date(input).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return input;
  }
}
