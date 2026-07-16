'use client';

import Link from 'next/link';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Layers,
  Calendar,
  GraduationCap,
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
  ArrowUpRight,
} from 'lucide-react';

import {
  studentApi,
  type AssignmentSummary,
  type LessonSummary,
  type ScheduleOccurrence,
  type SubmissionSummary,
} from '../../lib/api/student';
import { enrollmentApi } from '../../lib/api/enrollment';
import { liveApi } from '../../lib/api/live';
import { gamificationApi } from '../../lib/api/gamification';
import { ApiClientError } from '../../lib/api-client';
import { DailyChallengesWidget } from '../gamification/daily-challenges-widget';
import { tokens } from '../../lib/design/tokens';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

interface StudentDashboardProps {
  locale: string;
}

interface WeekScheduleRow {
  groupId: string;
  groupName: string;
  occurrence: ScheduleOccurrence;
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
const ONE_HOUR_MS = 60 * 60 * 1000;

export function StudentDashboard({ locale }: StudentDashboardProps) {
  const queryClient = useQueryClient();

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
        // ScheduleResponse exposes RRULE-expanded occurrences; the next one is
        // simply the first entry (server returns them ordered, UTC).
        nextOccurrence: schedule?.occurrences?.[0] ?? null,
        progress,
      };
    });
  }, [enrollments, groupQueries, lessonQueries, scheduleQueries]);

  // Yaqin 7 kunlik jadval — built from RRULE-expanded schedule occurrences
  // (NOT individual lessons). Each occurrence is a UTC { start, end } pair.
  const weekSchedule = useMemo<WeekScheduleRow[]>(() => {
    const now = Date.now();
    const cutoff = now + SEVEN_DAYS_MS;
    const rows: WeekScheduleRow[] = [];

    enrollments.forEach((enr, idx) => {
      const groupName = groupQueries[idx]?.data?.name ?? '—';
      const occurrences = scheduleQueries[idx]?.data?.occurrences ?? [];

      for (const occurrence of occurrences) {
        const when = Date.parse(occurrence.start);
        if (Number.isNaN(when)) continue;
        if (when < now - ONE_HOUR_MS) continue; // skip already-finished (1h grace)
        if (when > cutoff) continue;
        rows.push({ groupId: enr.groupId, groupName, occurrence });
      }
    });

    rows.sort(
      (a, b) => Date.parse(a.occurrence.start) - Date.parse(b.occurrence.start),
    );
    return rows.slice(0, 6);
  }, [enrollments, groupQueries, scheduleQueries]);

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
    return rows.slice(0, 5);
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
    return rows.slice(0, 5);
  }, [allAssignments, submissionQueries, lessonToGroup]);

  const notificationsQuery = useQuery({
    queryKey: ['student', 'notifications'],
    queryFn: () => studentApi.notifications(5),
  });

  const notifications = notificationsQuery.data?.data ?? [];

  // Hozir faol jonli darslar
  const liveSessionsQuery = useQuery({
    queryKey: ['student', 'live-sessions', 'active'],
    queryFn: () => liveApi.activeForMe(),
    refetchInterval: 30_000, // 30 soniyada bir tekshirish
  });
  const activeLiveSessions = liveSessionsQuery.data ?? [];

  // Gamifikatsiya profili (XP, daraja, streak) — bo'sh holatda ham ko'rsatiladi
  const gamificationQuery = useQuery({
    queryKey: ['gamification', 'me'],
    queryFn: () => gamificationApi.getProfile(),
  });
  const gp = gamificationQuery.data;

  // Bugungi maqsadlar — kunlik maqsad halqasi (progress ring) uchun
  const todayChallengesQuery = useQuery({
    queryKey: ['gamification', 'challenges', 'today'],
    queryFn: () => gamificationApi.getTodayChallenges(),
  });
  const todayChallenges = todayChallengesQuery.data ?? [];

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
    const STUDENT_LEVELS = [
      { level: 1, name: 'Yangi Talaba', minXp: 0 },
      { level: 2, name: 'Qiziquvchan', minXp: 300 },
      { level: 3, name: 'Izlovchi', minXp: 800 },
      { level: 4, name: 'Bilimdon', minXp: 1800 },
      { level: 5, name: 'Mohir', minXp: 3500 },
      { level: 6, name: 'Ustoz Shogirdi', minXp: 6000 },
      { level: 7, name: 'Ilm Fidoyisi', minXp: 10000 },
      { level: 8, name: 'Bilim Chempioni', minXp: 15000 },
      { level: 9, name: 'Elita', minXp: 22000 },
      { level: 10, name: 'Bilim Ustasi', minXp: 30000 },
    ];
    const totalXp = gp?.totalXp ?? 0;
    const level = gp?.currentLevel ?? 1;
    const streak = gp?.currentStreak ?? 0;
    const weeklyXp = gp?.weeklyXp ?? 0;
    const curDef = STUDENT_LEVELS.find((l) => l.level === level) ?? STUDENT_LEVELS[0]!;
    const nextDef = STUDENT_LEVELS.find((l) => l.level === level + 1) ?? null;
    const levelMax = nextDef?.minXp ?? curDef.minXp + 500;
    const levelPct = Math.min(100, Math.round(((totalXp - curDef.minXp) / Math.max(1, levelMax - curDef.minXp)) * 100));

    const goalsDone = todayChallenges.filter((c) => c.progress?.completed).length;
    const goalsTotal = todayChallenges.length;
    const goalPct = goalsTotal > 0 ? Math.round((goalsDone / goalsTotal) * 100) : 0;

    return (
      <div className="mx-auto max-w-7xl space-y-8 pb-12">
        {/* ── Salomlashish ── */}
        <header className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-8 shadow-soft sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue/5 blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-purple/5 blur-[80px]" />
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
              </span>
              Oʻquvchi paneli
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
              Xush kelibsiz! 👋
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
              Hali birorta guruhga qoʻshilmagansiz. Boshlash uchun kursni qidiring yoki oʻqituvchingiz bergan kod bilan qoʻshiling.
            </p>
          </div>
        </header>

        {/* ── Asosiy CTA + Daraja ── */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* CTA karta (2 ustun) */}
          <section className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 lg:col-span-2">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue/5 blur-2xl transition-all group-hover:bg-blue/10" />
            <div className="relative z-10 flex h-full flex-col">
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-tint px-3 py-1 text-[11px] font-bold text-blue">
                <BookOpen className="h-3.5 w-3.5" />
                Bilimni shu yerdan boshlang
              </div>
              <h2 className="mt-4 font-display text-lg font-extrabold tracking-tight text-ink-strong">
                Oʻrganishni boshlaymizmi?
              </h2>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">
                Jonli darslar, video materiallar, uy vazifalari va AI yordamchisi — barchasi bitta joyda.
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
                <Link
                  href={`/${locale}/search`}
                  className="group/btn inline-flex items-center gap-2 rounded-2xl bg-blue px-5 py-3 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
                >
                  <ScanLine className="h-4 w-4" />
                  Kurslarni qidirish
                  <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
                </Link>
                <div className="[&_button]:!rounded-2xl [&_button]:!border [&_button]:!border-rim [&_button]:!bg-tint [&_button]:!px-5 [&_button]:!py-3 [&_button]:!text-ink-strong [&_button:hover]:!bg-soft [&_button]:!shadow-none [&_button]:!font-bold">
                  <JoinByCodeModal locale={locale} />
                </div>
              </div>
            </div>
          </section>

          {/* Daraja karta */}
          <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">Daraja</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-tint text-sm font-bold text-blue">
                {level}
              </span>
            </div>
            <div className="mt-3 font-display text-base font-extrabold text-ink-strong">{curDef.name}</div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-tint">
              <div className="h-full rounded-full bg-blue transition-all duration-700" style={{ width: `${levelPct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] font-medium text-ink-faint">
              <span>{totalXp.toLocaleString()} XP</span>
              <span>{levelMax.toLocaleString()} XP</span>
            </div>
          </section>
        </div>

        {/* ── Statistika ── */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat icon={<Layers className="h-4 w-4" />} label="Umumiy XP" value={totalXp.toLocaleString()} />
          <MiniStat icon={<ArrowUpRight className="h-4 w-4" />} label="Haftalik XP" value={weeklyXp.toLocaleString()} />
          <MiniStat icon={<CheckCircle2 className="h-4 w-4" />} label="Streak" value={`${streak} kun`} />
          <MiniStat icon={<GraduationCap className="h-4 w-4" />} label="Daraja" value={`Lvl ${level}`} />
        </section>

        {/* ── Kunlik maqsadlar + halqa ── */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailyChallengesWidget />
          </div>
          <DailyGoalRing percent={goalPct} done={goalsDone} total={goalsTotal} />
        </div>

        {/* ── 3 qadam ── */}
        <section className="space-y-4">
          <SectionHeader icon={<GraduationCap className="h-5 w-5 text-blue" />} title="3 qadamda boshlang" />
          <div className="grid gap-4 sm:grid-cols-3">
            <StartStep step="01" title="Guruhga qoʻshiling" desc="Kod orqali yoki kurslarni qidirib oʻzingizga mos guruhni toping." icon={<ScanLine className="h-5 w-5" />} />
            <StartStep step="02" title="Darslarni oʻrganing" desc="Jonli darslar, videolar va AI yordamchisi bilan mashq qiling." icon={<PlayCircle className="h-5 w-5" />} />
            <StartStep step="03" title="XP va nishon yigʻing" desc="Vazifalarni bajaring, streak saqlang va reytingda yuqoriga chiqing." icon={<CheckCircle2 className="h-5 w-5" />} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* ── Salomlashish header ── */}
      <header className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue/5 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-purple/5 blur-[80px]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
              </span>
              Oʻquvchi paneli
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
              Xush kelibsiz! 👋
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft">
              Guruhlaringiz, jadvalingiz va vazifalaringiz — barchasi bir joyda.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/${locale}/schedule`}
              className="flex items-center gap-2 rounded-2xl border border-rim bg-tint px-5 py-2.5 text-sm font-bold text-ink-strong transition-all hover:bg-canvas hover:border-blue/30 active:scale-[0.98]"
            >
              <Calendar className="h-4 w-4 text-blue" />
              Jadval
            </Link>
            <Link
              href={`/${locale}/search`}
              className="group/btn inline-flex items-center gap-2 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
            >
              <ScanLine className="h-4 w-4" />
              Kurs qidirish
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Kunlik maqsadlar ── */}
      <DailyChallengesWidget />

      {/* ── Jonli efir banneri ── */}
      {activeLiveSessions.length > 0 && (
        <div className="relative overflow-hidden rounded-3xl border border-red/20 bg-red-tint p-5 shadow-soft">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-red/10 blur-2xl" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-lg bg-red/10 px-2.5 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red" />
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-red">Jonli efir</span>
              </div>
              <p className="text-sm font-bold text-ink-strong">
                {activeLiveSessions.length > 1
                  ? `${activeLiveSessions.length} ta dars hozir jonli olib borilyapti!`
                  : 'Dars hozir jonli olib borilyapti!'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeLiveSessions.map((session) => (
                <Link
                  key={session.lessonId}
                  href={`/${locale}/live/${session.lessonId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red px-4 py-2 text-sm font-bold text-white shadow-soft transition-all hover:opacity-90 active:scale-[0.98]"
                >
                  <PlayCircle className="h-4 w-4" />
                  Qoʻshilish
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Asosiy kontent — 2 ustunli grid ── */}
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        {/* Chap ustun */}
        <div className="w-full min-w-0 flex-1 space-y-8">
          {/* A) Mening guruhlarim */}
          <section className="space-y-4">
            <SectionHeader
              icon={<Layers className="h-5 w-5 text-blue" />}
              title="Mening guruhlarim"
              action={
                <Link
                  href={`/${locale}/my-courses`}
                  className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-blue transition-all hover:bg-blue/5 hover:text-blue-600"
                >
                  Barchasi <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />

            {groups.length === 0 ? (
              <EmptyCard icon={<Layers className="h-7 w-7" />} text="Hali guruhlar yoʻq" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {groups.map((g) => (
                  <Link
                    key={g.groupId}
                    href={`/${locale}/groups/${g.groupId}`}
                    className="group relative flex flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-blue/30 hover:shadow-blue-soft"
                  >
                    <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-transparent to-blue/[0.04] transition-all duration-500 group-hover:scale-150" />
                    <div className="relative flex items-start justify-between">
                      <div className="rounded-2xl bg-blue-tint p-2.5 text-blue">
                        <BookOpen className="h-5 w-5" />
                      </div>
                      {g.nextOccurrence && (
                        <div className="flex items-center gap-1.5 rounded-full border border-blue/10 bg-blue/5 px-2.5 py-1">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
                          </span>
                          <span className="text-[9px] font-black uppercase tracking-wider text-blue">
                            Navbatdagi dars
                          </span>
                        </div>
                      )}
                    </div>

                    <h3 className="relative mt-4 truncate font-display text-sm font-extrabold text-ink-strong transition-colors group-hover:text-blue">
                      {g.name}
                    </h3>
                    <div className="relative mt-1 text-xs font-medium text-ink-faint">
                      {g.lessonsCount} ta dars
                    </div>

                    <div className="relative mt-6 space-y-2">
                      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-ink-faint">
                        <span>Oʻzlashtirish</span>
                        <span>{g.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
                        <div
                          className="h-full rounded-full bg-blue transition-all duration-700 ease-out"
                          style={{ width: `${g.progress}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* B) Yaqin 7 kunlik jadval */}
          <section className="space-y-4">
            <SectionHeader
              icon={<Calendar className="h-5 w-5 text-blue" />}
              title="Yaqin 7 kunlik jadval"
              action={
                <Link
                  href={`/${locale}/schedule`}
                  className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-blue transition-all hover:bg-blue/5 hover:text-blue-600"
                >
                  Toʻliq jadval <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />

            {weekSchedule.length === 0 ? (
              <div className="flex min-h-[120px] flex-col items-center justify-center rounded-3xl border border-dashed border-rim bg-canvas py-8 text-center shadow-soft">
                <CalendarX className="mb-2 h-8 w-8 text-ink-ghost" />
                <p className="text-sm font-bold text-ink-strong">Jadval belgilanmagan</p>
                <p className="mt-1 text-xs text-ink-soft">Yaqin 7 kun ichida belgilangan dars yoʻq.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-rim bg-canvas shadow-soft">
                <ul className="divide-y divide-rim">
                  {weekSchedule.map((row, idx) => (
                    <li key={`${row.groupId}-${row.occurrence.start}-${idx}`}>
                      <Link
                        href={`/${locale}/groups/${row.groupId}`}
                        className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-tint"
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl bg-blue-tint text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                            <span className="text-base font-black leading-none">
                              {formatDayNumber(row.occurrence.start)}
                            </span>
                            <span className="text-[8px] font-bold uppercase tracking-wide">
                              {formatMonthShort(row.occurrence.start)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-ink-strong transition-colors group-hover:text-blue">
                              {row.groupName}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                              {formatWeekday(row.occurrence.start)}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 rounded-xl bg-tint px-2.5 py-1.5 text-xs font-bold text-ink-strong">
                          <Clock className="h-3.5 w-3.5 text-ink-faint" />
                          {formatTimeRange(row.occurrence.start, row.occurrence.end)}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* Oʻng ustun (rail) */}
        <aside className="w-full space-y-8 lg:w-80 lg:shrink-0">
          {/* C) Uy vazifalari */}
          <section className="space-y-3">
            <RailHeader
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              title="Uy vazifalari"
              action={
                <Link href={`/${locale}/homework`} className="text-[11px] font-bold text-blue hover:text-blue-600">
                  Hammasi
                </Link>
              }
            />

            {pendingHomework.length === 0 ? (
              <EmptyCard
                icon={<CheckCircle2 className="h-7 w-7 text-green" />}
                text="Hamma vazifa topshirilgan!"
                tone="success"
              />
            ) : (
              <div className="space-y-3">
                {pendingHomework.map(({ assignment, groupName, submission }) => (
                  <Link
                    key={assignment.id}
                    href={`/${locale}/assignments/${assignment.id}`}
                    className="group block rounded-2xl border border-rim bg-canvas p-4 shadow-soft transition-all hover:border-blue/20 hover:shadow-medium"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink-strong transition-colors group-hover:text-blue">
                          {assignment.title}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                          {groupName}
                        </p>
                      </div>
                      <DueBadge due={assignment.dueAt ?? ''} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="rounded-full border border-blue/10 bg-blue/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue">
                        {submission?.status === 'DRAFT'
                          ? 'Qoralama'
                          : submission?.status === 'RETURNED'
                            ? 'Qaytarildi'
                            : 'Kutilmoqda'}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-blue" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* D) Xabarnomalar */}
          <section className="space-y-3">
            <RailHeader icon={<Bell className="h-3.5 w-3.5" />} title="Xabarnomalar" />

            {notifications.length === 0 ? (
              <EmptyCard icon={<BellOff className="h-7 w-7" />} text="Yangi xabarlar yoʻq" />
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-2xl border border-rim bg-canvas p-3.5 shadow-soft transition-all hover:border-blue/20"
                  >
                    <div className="flex gap-3">
                      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />}
                      <div className="min-w-0">
                        <p className="text-xs font-bold leading-tight text-ink-strong">{n.title}</p>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-ink-soft">{n.body}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* E) Oxirgi baholar */}
          <section className="space-y-3">
            <RailHeader icon={<GraduationCap className="h-3.5 w-3.5" />} title="Oxirgi baholar" />

            {recentGrades.length === 0 ? (
              <EmptyCard icon={<ClipboardList className="h-7 w-7" />} text="Hali baholar yoʻq" />
            ) : (
              <div className="space-y-2">
                {recentGrades.map(({ assignment, submission }) => (
                  <div
                    key={submission.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-rim bg-canvas p-3.5 shadow-soft"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ink-strong">{assignment.title}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                        {submission.gradedAt ? formatDateOnly(submission.gradedAt) : '—'}
                      </p>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue text-xs font-black text-white shadow-blue-soft">
                      {submission.score ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Yangi guruhga qoʻshilish */}
          <div
            className="group relative overflow-hidden rounded-3xl p-6 text-white shadow-medium"
            style={{ background: `linear-gradient(135deg, ${tokens.brand.primary} 0%, ${tokens.ai.accent} 100%)` }}
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15 blur-2xl transition-transform duration-700 group-hover:scale-150" />
            <div className="relative z-10">
              <h3 className="font-display text-base font-extrabold">Yangi guruhga qoʻshilish</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-white/85">
                Oʻqituvchingiz bergan maxsus kodni kiritib oʻrganishni boshlang.
              </p>
              <div className="mt-4">
                <JoinByCodeModal locale={locale} />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section / rail headers
// ──────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-ink-strong">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

function RailHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-ink-faint">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

function EmptyCard({
  icon,
  text,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  text: string;
  tone?: 'muted' | 'success';
}) {
  return (
    <div className="flex min-h-[88px] flex-col items-center justify-center rounded-2xl border border-rim bg-canvas p-6 text-center shadow-soft">
      <span className={tone === 'success' ? 'mb-2 text-green' : 'mb-2 text-ink-ghost'}>{icon}</span>
      <p className="text-xs font-bold text-ink-strong">{text}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Join-by-code modal
// ──────────────────────────────────────────────────────────────────────

function JoinByCodeModal({ locale }: { locale: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'INPUT' | 'PREVIEW'>('INPUT');
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setCode('');
    setStep('INPUT');
    setGroupInfo(null);
    setError(null);
  }, []);

  // Close the overlay and reset its state. Used by the close button, the
  // backdrop, and `Esc` (via useFocusTrap).
  const handleClose = useCallback(() => {
    setIsOpen(false);
    reset();
  }, [reset]);

  // Custom (non-Radix) overlay: trap Tab focus inside the dialog, close on
  // `Esc`, and restore focus to the opener when it closes (Req 7.1–7.3).
  useFocusTrap(dialogRef, { active: isOpen, onClose: handleClose });

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
      setError('Guruh topilmadi yoki kod xato.');
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
    onError: () => {
      setError('Soʻrov yuborishda xato.');
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-canvas px-6 py-3 text-sm font-bold text-blue transition-all hover:shadow-medium active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        Guruhga qoʻshilish
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/60 p-4 backdrop-blur-md duration-300 animate-in fade-in"
          onClick={handleClose}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Guruhga qoʻshilish"
            tabIndex={-1}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-rim bg-canvas text-ink-strong shadow-medium duration-300 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-rim px-7 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-tint text-blue">
                  <ScanLine className="h-5 w-5" />
                </div>
                <h2 className="font-display text-lg font-extrabold tracking-tight">Guruhga qoʻshilish</h2>
              </div>
              <button
                type="button"
                aria-label="Yopish"
                onClick={handleClose}
                className="rounded-full p-2 text-ink-faint transition-all hover:bg-tint hover:text-ink-strong"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="p-7">
              {step === 'INPUT' ? (
                <form onSubmit={handleSearch} className="space-y-6">
                  <div className="text-center">
                    <p className="mb-6 px-2 text-sm font-medium text-ink-soft">
                      Oʻqituvchingiz bergan 6 xonali maxsus kodni kiriting.
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABC-123"
                      className="w-full rounded-2xl border-2 border-rim bg-tint py-5 text-center text-3xl font-black uppercase tracking-[0.4em] text-ink-strong outline-none transition-all focus:border-blue/40 focus:bg-canvas focus:ring-4 focus:ring-blue/10"
                    />
                  </div>
                  {error && (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-red/20 bg-red-tint py-3 text-xs font-bold text-red">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading || code.length < 4}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue py-4 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Guruhni topish'}
                  </button>
                </form>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-1 rounded-2xl border border-rim bg-tint p-6 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue">Topilgan guruh</p>
                    <h3 className="pt-2 font-display text-xl font-extrabold text-ink-strong">{groupInfo.groupName}</h3>
                    <p className="text-xs font-bold text-ink-faint">{groupInfo.courseTitle}</p>

                    <div className="mt-6 grid grid-cols-2 gap-4 border-t border-rim pt-6">
                      <div className="text-left">
                        <p className="text-[9px] font-black uppercase tracking-widest text-ink-faint">Narxi</p>
                        <p className="mt-0.5 text-sm font-black text-ink-strong">
                          {groupInfo.priceUzs === 0
                            ? 'Bepul'
                            : new Intl.NumberFormat('uz-UZ').format(groupInfo.priceUzs) + ' soʻm'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-ink-faint">Oʻqituvchi</p>
                        <p className="mt-0.5 truncate text-sm font-black text-ink-strong">{groupInfo.teacherName}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setStep('INPUT')}
                      className="flex-1 rounded-2xl border-2 border-rim py-3.5 text-sm font-bold text-ink-soft transition-all hover:bg-tint active:scale-[0.98]"
                    >
                      Orqaga
                    </button>
                    <button
                      type="button"
                      onClick={() => joinMutation.mutate()}
                      disabled={joinMutation.isPending}
                      className="flex-[2] rounded-2xl bg-blue py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
                    >
                      Qoʻshilish
                    </button>
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

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-rim bg-canvas p-4 shadow-soft">
      <div className="flex items-center gap-2 text-ink-faint">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tint text-ink-soft">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="mt-2 font-display text-xl font-extrabold tracking-tight text-ink-strong">{value}</div>
    </div>
  );
}

function DailyGoalRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke={tokens.brand.primaryTint} strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={tokens.brand.primary}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink-strong">{percent}%</span>
          <span className="text-[10px] font-medium text-ink-faint">
            {done}/{total || 0}
          </span>
        </div>
      </div>
      <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">Kunlik maqsad</div>
      <div className="mt-1 text-center text-[11px] text-ink-faint">Davom eting 🔥</div>
    </div>
  );
}

function StartStep({
  step,
  title,
  desc,
  icon,
}: {
  step: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all duration-300 hover:border-blue/20 hover:shadow-medium">
      <div className="flex items-center justify-between">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-tint text-blue">{icon}</div>
        <span className="font-display text-2xl font-extrabold text-ink-ghost">{step}</span>
      </div>
      <h3 className="mt-4 text-sm font-bold text-ink-strong">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{desc}</p>
    </div>
  );
}

function DueBadge({ due }: { due: string }) {
  if (!due)
    return (
      <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-ink-faint">Muddatsiz</span>
    );
  const ms = Date.parse(due) - Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (ms < 0)
    return (
      <span className="shrink-0 rounded-full border border-red/10 bg-red/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-red">
        Kechikkan
      </span>
    );
  if (ms < dayMs)
    return (
      <span className="shrink-0 rounded-full border border-orange/10 bg-orange/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-orange">
        Bugun
      </span>
    );

  return (
    <span className="shrink-0 rounded-full border border-blue/10 bg-blue/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue">
      {Math.ceil(ms / dayMs)} kun qoldi
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center gap-3 rounded-3xl border border-red/20 bg-red-tint p-6 text-sm font-bold text-red shadow-soft">
        <AlertCircle className="h-6 w-6 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <div className="h-28 w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 space-y-6">
          <div className="h-64 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
          <div className="h-80 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
        </div>
        <div className="h-[560px] w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft lg:w-80" />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Date / time formatting (UTC ISO → uz-UZ local display)
// ──────────────────────────────────────────────────────────────────────

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

function formatDayNumber(input: string): string {
  try {
    return new Date(input).toLocaleDateString('uz-UZ', { day: '2-digit' });
  } catch {
    return '--';
  }
}

function formatMonthShort(input: string): string {
  try {
    return new Date(input).toLocaleDateString('uz-UZ', { month: 'short' });
  } catch {
    return '';
  }
}

function formatWeekday(input: string): string {
  try {
    return new Date(input).toLocaleDateString('uz-UZ', { weekday: 'long' });
  } catch {
    return '';
  }
}

function formatTimeRange(start: string, end: string): string {
  try {
    const fmt = (d: Date) => d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    return `${fmt(new Date(start))} – ${fmt(new Date(end))}`;
  } catch {
    return '';
  }
}
