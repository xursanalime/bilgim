'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, 
  Layers, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  Plus, 
  BarChart3,
  Search,
  ClipboardList,
  GraduationCap
} from 'lucide-react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentWithModules,
  type Submission,
} from '../../lib/api/homework';
import { coursesApi, groupsApi, lessonsApi } from '../../lib/api/catalog';
import {
  studentApi,
  type LessonSummary,
  type StudentEnrollment,
} from '../../lib/api/student';
import { SubmissionStatusBadge } from './submission-status-badge';
import { cn } from '../../lib/utils';

interface HomeworkOverviewProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

export function HomeworkOverview({ locale, role }: HomeworkOverviewProps) {
  if (role === 'STUDENT') {
    return <StudentHomework locale={locale} />;
  }
  return <TeacherHomework locale={locale} />;
}

// ────────────────────────────────────────────────────────────────────
// STUDENT
// ────────────────────────────────────────────────────────────────────

interface StudentRow {
  groupId: string;
  groupName: string;
  lesson: LessonSummary;
  assignment: AssignmentWithModules;
  submission: Submission | null;
}

async function fetchStudentHomework(): Promise<StudentRow[]> {
  const enrollments: StudentEnrollment[] = await studentApi.myEnrollments();
  if (enrollments.length === 0) return [];

  const groupAndLessonPairs = await Promise.all(
    enrollments.map(async (enr) => {
      const [group, lessons] = await Promise.all([
        studentApi.getGroup(enr.groupId).catch(() => null),
        studentApi.listLessons(enr.groupId).catch(() => [] as LessonSummary[]),
      ]);
      return { enr, groupName: group?.name ?? '—', lessons };
    }),
  );

  const rows: StudentRow[] = [];
  await Promise.all(
    groupAndLessonPairs.flatMap(({ enr, groupName, lessons }) =>
      lessons.map(async (lesson) => {
        const assignments = await homeworkApi
          .listForLesson(lesson.id)
          .catch(() => [] as AssignmentWithModules[]);

        const published = assignments.filter((a) => a.isPublished);
        const submissionPairs = await Promise.all(
          published.map(async (assignment) => ({
            assignment,
            submission: await homeworkApi
              .getMyForAssignment(assignment.id)
              .catch(() => null),
          })),
        );

        for (const { assignment, submission } of submissionPairs) {
          rows.push({ groupId: enr.groupId, groupName, lesson, assignment, submission });
        }
      }),
    ),
  );

  rows.sort((a, b) => {
    const ta = a.assignment.dueAt ? Date.parse(a.assignment.dueAt) : Number.POSITIVE_INFINITY;
    const tb = b.assignment.dueAt ? Date.parse(b.assignment.dueAt) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return rows;
}

function StudentHomework({ locale }: { locale: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['homework', 'student-overview'],
    queryFn: fetchStudentHomework,
  });

  if (isLoading) return <ListSkeleton />;
  if (error) {
    return (
      <ErrorBanner
        message={error instanceof ApiClientError ? error.message : "Ma'lumotlarni yuklashda xato yuz berdi."}
      />
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-10">
        <HeroHeader 
          title="Uy vazifalari" 
          subtitle="Guruhlaringizdagi barcha topshiriqlar va ularning holati." 
          icon={ClipboardList}
          color="blue"
        />
        <EmptyState
          title="Hozircha topshiriq yo'q"
          body="O'qituvchingiz topshiriq e'lon qilganda u shu yerda paydo bo'ladi."
          ctaHref={`/${locale}/search`}
          ctaLabel="Kurslarni qidirish"
        />
      </div>
    );
  }

  const grouped = new Map<string, StudentRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.groupName)) grouped.set(row.groupName, []);
    grouped.get(row.groupName)!.push(row);
  }

  const pendingCount = rows.filter(r => !r.submission || r.submission.status === 'DRAFT' || r.submission.status === 'RETURNED').length;

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      <HeroHeader 
        title="Uy vazifalari" 
        subtitle="Guruhlaringizdagi barcha topshiriqlar va ularning holati." 
        icon={ClipboardList}
        color="blue"
        badge={pendingCount > 0 ? { label: 'Bajarilmagan', value: `${pendingCount} ta` } : undefined}
      />

      <div className="space-y-12">
        {Array.from(grouped.entries()).map(([groupName, items]) => (
          <section key={groupName} className="space-y-6">
            <div className="flex items-center gap-3 border-b border-rim pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/5 text-purple">
                <Layers className="h-5 w-5" />
              </div>
              <h2 className="font-display text-lg font-extrabold text-ink-strong">{groupName}</h2>
            </div>
            
            <div className="grid gap-4">
              {items.map((row) => (
                <Link
                  key={row.assignment.id}
                  href={`/${locale}/homework/${row.assignment.id}`}
                  className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-4 sm:items-center">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                        {row.assignment.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-faint">
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          {row.lesson.title}
                        </span>
                        {row.assignment.dueAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Muddat: {formatDateTime(row.assignment.dueAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-rim pt-4 sm:mt-0 sm:border-0 sm:pt-0">
                    <div className="flex items-center gap-3">
                      {row.submission ? (
                        <SubmissionStatusBadge status={row.submission.status} />
                      ) : (
                        <span className="rounded-full bg-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft border border-rim">
                          Boshlanmagan
                        </span>
                      )}
                      {row.submission?.status === 'GRADED' && row.submission.score !== null ? (
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-black text-green">
                            {row.submission.score}/{row.assignment.totalPoints}
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-tight text-ink-faint">Ball</span>
                        </div>
                      ) : null}
                    </div>
                    <ChevronRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TEACHER
// ────────────────────────────────────────────────────────────────────

interface TeacherRow {
  groupId: string;
  groupName: string;
  courseTitle: string;
  lesson: LessonSummary;
  assignment: AssignmentWithModules;
  submissions: Submission[];
}

async function fetchTeacherHomework(): Promise<TeacherRow[]> {
  const courses = await coursesApi.list();
  if (courses.length === 0) return [];

  const courseGroupPairs = await Promise.all(
    courses.map(async (course) => {
      const groups = await groupsApi.listForCourse(course.id).catch(() => [] as Awaited<ReturnType<typeof groupsApi.listForCourse>>);
      return { course, groups };
    }),
  );

  const rows: TeacherRow[] = [];
  await Promise.all(
    courseGroupPairs.flatMap(({ course, groups }) =>
      groups.map(async (group) => {
        const lessons = await lessonsApi.listForGroup(group.id).catch(() => [] as LessonSummary[]);
        await Promise.all(
          lessons.map(async (lesson) => {
            const assignments = await homeworkApi.listForLesson(lesson.id).catch(() => [] as AssignmentWithModules[]);
            await Promise.all(
              assignments.map(async (assignment) => {
                const submissions = await homeworkApi.listForAssignment(assignment.id).catch(() => [] as Submission[]);
                rows.push({
                  groupId: group.id,
                  groupName: group.name,
                  courseTitle: course.title,
                  lesson: lesson as unknown as LessonSummary,
                  assignment,
                  submissions,
                });
              }),
            );
          }),
        );
      }),
    ),
  );

  rows.sort((a, b) => {
    const aPending = countPending(a.submissions);
    const bPending = countPending(b.submissions);
    if (aPending !== bPending) return bPending - aPending;
    return Date.parse(b.assignment.createdAt) - Date.parse(a.assignment.createdAt);
  });
  return rows;
}

function countPending(subs: Submission[]): number {
  return subs.filter((s) => s.status === 'SUBMITTED' || s.status === 'IN_REVIEW').length;
}

function TeacherHomework({ locale }: { locale: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['homework', 'teacher-overview'],
    queryFn: fetchTeacherHomework,
  });

  if (isLoading) return <ListSkeleton />;
  if (error) {
    return (
      <ErrorBanner
        message={error instanceof ApiClientError ? error.message : "Ma'lumotlarni yuklashda xato yuz berdi."}
      />
    );
  }

  const rows = data ?? [];
  const totalPending = rows.reduce((acc, row) => acc + countPending(row.submissions), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <HeroHeader 
          title="Topshiriqlar" 
          subtitle="Siz yaratgan barcha vazifalar va ularning topshirilish statistikasi." 
          icon={ClipboardList}
          color="purple"
          badge={totalPending > 0 ? { label: 'Navbatda', value: `${totalPending} ta` } : undefined}
        />
        
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href={`/${locale}/homework/grading`}
            className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-6 py-3 text-sm font-bold text-ink-strong transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98]"
          >
            <BarChart3 className="h-4 w-4 text-blue" />
            <span>Tekshirish navbati</span>
          </Link>
          <Link
            href={`/${locale}/homework/new`}
            className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-6 py-3 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Plus className="h-4.5 w-4.5 transition-transform group-hover:rotate-90" />
            <span>Yangi topshiriq</span>
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Hali topshiriq yaratmagansiz"
          body="Darslar ichidan AssignmentBuilder orqali yangi topshiriq qo'shing."
          ctaHref={`/${locale}/dashboard/courses`}
          ctaLabel="Kurslarga o'tish"
        />
      ) : (
        <div className="grid gap-6">
          {rows.map((row) => {
            const counts = countByStatus(row.submissions);
            const pendingCount = counts.SUBMITTED + counts.IN_REVIEW;
            const progress = row.submissions.length > 0 ? (counts.GRADED / row.submissions.length) * 100 : 0;
            
            return (
              <Link
                key={row.assignment.id}
                href={`/${locale}/homework/${row.assignment.id}`}
                className="group relative flex flex-col overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 lg:flex-row lg:items-center lg:gap-8"
              >
                <div className="flex flex-1 items-start gap-5 lg:items-center">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.5rem] bg-purple/5 text-purple transition-colors group-hover:bg-purple group-hover:text-white">
                    <ClipboardList className="h-7 w-7" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                      {row.assignment.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-ink-faint">
                      <span className="font-bold text-blue">{row.courseTitle}</span>
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {row.groupName}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-rim pt-6 lg:mt-0 lg:border-0 lg:pt-0">
                  <div className="flex items-center gap-6">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Navbatda</p>
                      <p className={cn("text-base font-black", pendingCount > 0 ? "text-orange" : "text-ink-strong")}>
                        {pendingCount}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Baholangan</p>
                      <p className="text-base font-black text-ink-strong">{counts.GRADED}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Jami</p>
                      <p className="text-base font-black text-ink-strong">{row.submissions.length}</p>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-1.5 lg:w-32">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tight">
                      <span className="text-ink-faint">Progress</span>
                      <span className="text-blue">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
                      <div 
                        className="h-full bg-blue transition-all duration-1000" 
                        style={{ width: `${progress}%` }} 
                      />
                    </div>
                  </div>

                  <ChevronRight className="hidden h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue lg:block" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function countByStatus(subs: Submission[]) {
  const acc = { DRAFT: 0, SUBMITTED: 0, IN_REVIEW: 0, GRADED: 0, RETURNED: 0 };
  for (const s of subs) acc[s.status] += 1;
  return acc;
}

// ────────────────────────────────────────────────────────────────────
// Shared components
// ────────────────────────────────────────────────────────────────────

function HeroHeader({ 
  title, 
  subtitle, 
  icon: Icon, 
  color = 'blue',
  badge 
}: { 
  title: string; 
  subtitle: string; 
  icon: any; 
  color?: 'blue' | 'purple' | 'green';
  badge?: { label: string; value: string } | undefined;
}) {
  const colorClasses = {
    blue: 'bg-blue/5 text-blue',
    purple: 'bg-purple/5 text-purple',
    green: 'bg-green/5 text-green'
  };

  return (
    <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
      <div className={cn(
        "pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full blur-[80px]",
        color === 'blue' ? 'bg-blue/5' : color === 'purple' ? 'bg-purple/5' : 'bg-green/5'
      )} />
      
      <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-4">
          <div className={cn("flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em]", color === 'blue' ? 'text-blue' : color === 'purple' ? 'text-purple' : 'text-green')}>
            <Icon className="h-3.5 w-3.5" />
            Loyiha boshqaruvi
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
              {title}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
              {subtitle}
            </p>
          </div>
        </div>

        {badge && (
          <div className="flex items-center gap-2.5 pt-2">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", colorClasses[color])}>
              <Icon className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{badge.label}</p>
              <p className="text-sm font-black text-ink-strong">{badge.value}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function EmptyState({ title, body, ctaHref, ctaLabel }: { title: string; body: string; ctaHref?: string; ctaLabel?: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue shadow-sm">
          <ClipboardList className="h-10 w-10" />
        </div>
      </div>
      <h2 className="font-display text-xl font-extrabold text-ink-strong">
        {title}
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        {body}
      </p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="group mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
        <AlertCircle className="h-5 w-5 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-3xl bg-white border border-rim" />
        ))}
      </div>
    </div>
  );
}

function formatDateTime(input: string): string {
  try {
    return new Date(input).toLocaleString('uz-UZ', { 
      day: '2-digit', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch {
    return input;
  }
}
