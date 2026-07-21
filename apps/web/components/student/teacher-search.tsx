'use client';

import Link from 'next/link';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';

import {
  discoveryApi,
  type DiscoveryCourseSummary,
  type DiscoveryGroupSummary,
  type DiscoveryTeacherSummary,
} from '../../lib/api/discovery';
import { enrollmentApi, type EnrollmentRequest } from '../../lib/api/enrollment';
import { ApiClientError } from '../../lib/api-client';
import { formatRating, formatUzs, getInitials } from '../marketing/discovery-cards';

interface TeacherSearchProps {
  locale: string;
}

/** How many course pages we scan (client-side) to find a teacher's open
 * courses — the public discovery API has no `teacherId` filter, so we
 * page through and filter, same bounded approach used by the public
 * teacher profile page (`(marketing)/teachers/[publicSlug]/page.tsx`). */
const COURSE_LOOKUP_PAGE_SIZE = 50;
const MAX_LOOKUP_PAGES = 6;

export function TeacherSearch({ locale }: TeacherSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expandedTeacherId, setExpandedTeacherId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const teachersQuery = useQuery({
    queryKey: ['discovery', 'teachers', debouncedQuery],
    queryFn: () =>
      discoveryApi.listTeachers({
        ...(debouncedQuery.length >= 2 && { q: debouncedQuery }),
        pageSize: 24,
      }),
  });

  const requestsQuery = useQuery({
    queryKey: ['student', 'requests'],
    queryFn: () => enrollmentApi.myRequests(),
  });

  const requestsByGroup = useMemo(() => {
    const map: Record<string, EnrollmentRequest['status']> = {};
    for (const r of requestsQuery.data ?? []) map[r.groupId] = r.status;
    return map;
  }, [requestsQuery.data]);

  const teachers = teachersQuery.data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <div>
        <Link
          href={`/${locale}/dashboard`}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Boshqaruvga qaytish
        </Link>
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
          Oʻqituvchilarni qidirish
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
          Platformadagi oʻqituvchilarni koʻrib chiqing, kurslarini oching va mos guruhga qoʻshilish soʻrovini yuboring.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ism yoki mutaxassislik boʻyicha qidiring..."
          className="w-full rounded-2xl border border-rim bg-canvas py-4 pl-11 pr-5 text-sm font-medium text-ink-strong shadow-soft outline-none transition-all placeholder:text-ink-faint focus:border-blue/30 focus:ring-4 focus:ring-blue/10"
        />
      </div>

      {teachersQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
          ))}
        </div>
      ) : teachersQuery.isError ? (
        <div className="rounded-3xl border border-red/15 bg-red-tint p-8 text-center text-sm font-bold text-red">
          Oʻqituvchilarni yuklashda xato yuz berdi.
        </div>
      ) : teachers.length === 0 ? (
        <div className="rounded-3xl border border-rim bg-canvas p-10 text-center shadow-soft">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-tint text-blue">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-extrabold text-ink-strong">Hech narsa topilmadi</h3>
          <p className="mt-2 text-sm text-ink-soft">
            {debouncedQuery
              ? "Boshqa kalit soʻz bilan qayta urinib koʻring."
              : "Hozircha ochiq oʻqituvchi profillari mavjud emas."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {teachers.map((teacher) => (
            <TeacherCard
              key={teacher.id}
              teacher={teacher}
              expanded={expandedTeacherId === teacher.id}
              onToggle={() =>
                setExpandedTeacherId((prev) => (prev === teacher.id ? null : teacher.id))
              }
              requestsByGroup={requestsByGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherCard({
  teacher,
  expanded,
  onToggle,
  requestsByGroup,
}: {
  teacher: DiscoveryTeacherSummary;
  expanded: boolean;
  onToggle: () => void;
  requestsByGroup: Record<string, EnrollmentRequest['status']>;
}) {
  const fullName = teacher.fullName ?? 'Oʻqituvchi';

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-rim bg-canvas shadow-soft transition-all hover:border-blue/20 hover:shadow-medium">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col p-6 text-left"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-tint text-blue">
            {teacher.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={teacher.avatarUrl} alt={fullName} className="h-full w-full object-cover" />
            ) : (
              <span className="text-base font-extrabold tracking-tight">{getInitials(fullName)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-extrabold tracking-tight text-ink-strong">{fullName}</h3>
            {teacher.headline && (
              <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{teacher.headline}</p>
            )}
          </div>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-ink-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          {teacher.specialty && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-bold text-blue">
              {teacher.specialty.nameUz}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
            ★ {formatRating(teacher.rating)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
            <Users className="h-3 w-3" /> {teacher.studentsCount}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
            {teacher.courseCount} kurs
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-rim bg-tint/50 p-6">
          <TeacherCourses teacher={teacher} requestsByGroup={requestsByGroup} />
        </div>
      )}
    </div>
  );
}

function TeacherCourses({
  teacher,
  requestsByGroup,
}: {
  teacher: DiscoveryTeacherSummary;
  requestsByGroup: Record<string, EnrollmentRequest['status']>;
}) {
  const coursesQuery = useQuery({
    queryKey: ['discovery', 'teacherCourses', teacher.slug ?? teacher.id],
    queryFn: () => fetchTeacherCourses(teacher.slug),
    enabled: Boolean(teacher.slug),
  });

  const courses = coursesQuery.data ?? [];

  const groupQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: ['discovery', 'courseGroups', course.id],
      queryFn: () => discoveryApi.getCourseGroups(course.id),
    })),
  });

  if (!teacher.slug || coursesQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded-full bg-soft" />
        <div className="h-20 animate-pulse rounded-2xl bg-soft" />
      </div>
    );
  }

  if (coursesQuery.isError) {
    return <p className="text-sm font-bold text-red">Kurslarni yuklashda xato yuz berdi.</p>;
  }

  if (courses.length === 0) {
    return <p className="text-sm text-ink-soft">Bu oʻqituvchining hozircha ochiq kursi yoʻq.</p>;
  }

  return (
    <div className="space-y-5">
      {courses.map((course, i) => (
        <div key={course.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-extrabold text-ink-strong">{course.title}</h4>
            {course.level && (
              <span className="rounded-full border border-rim bg-canvas px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                {course.level}
              </span>
            )}
          </div>
          {course.description && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{course.description}</p>
          )}

          <div className="mt-3 space-y-2">
            {groupQueries[i]?.isLoading && (
              <div className="h-14 animate-pulse rounded-2xl bg-soft" />
            )}
            {groupQueries[i]?.data?.length === 0 && (
              <p className="text-xs text-ink-faint">Ochiq guruh yoʻq.</p>
            )}
            {groupQueries[i]?.data?.map((group) => (
              <GroupJoinRow key={group.id} group={group} status={requestsByGroup[group.id]} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupJoinRow({
  group,
  status,
}: {
  group: DiscoveryGroupSummary;
  status: EnrollmentRequest['status'] | undefined;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const joinMutation = useMutation({
    mutationFn: () => enrollmentApi.createRequest(group.id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['student', 'requests'] });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Soʻrov yuborishda xato.");
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-rim bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink-strong">{group.name}</p>
        <p className="mt-0.5 text-xs font-semibold text-ink-faint">
          {group.priceUzs > 0 ? `${formatUzs(group.priceUzs)} soʻm` : 'Bepul'}
          {group.startsOn ? ` · ${new Date(group.startsOn).toLocaleDateString('uz-UZ')}` : ''}
        </p>
        {error && <p className="mt-1 text-xs font-bold text-red">{error}</p>}
      </div>
      <JoinRequestButton
        status={status}
        isPending={joinMutation.isPending}
        justSucceeded={joinMutation.isSuccess}
        onClick={() => joinMutation.mutate()}
      />
    </div>
  );
}

function JoinRequestButton({
  status,
  isPending,
  justSucceeded,
  onClick,
}: {
  status: EnrollmentRequest['status'] | undefined;
  isPending: boolean;
  justSucceeded: boolean;
  onClick: () => void;
}) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-xl border border-green/20 bg-green-tint px-4 py-2 text-xs font-bold text-green">
        Qoʻshilgansiz
      </span>
    );
  }
  if (justSucceeded || status === 'PENDING_APPROVAL' || status === 'PENDING_PAYMENT') {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-xl border border-rim bg-tint px-4 py-2 text-xs font-bold text-ink-soft">
        Soʻrov yuborildi
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue px-4 py-2 text-xs font-bold text-white shadow-[0_8px_16px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-95 disabled:opacity-60"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {status === 'REJECTED' ? 'Qayta soʻrash' : "Soʻrov yuborish"}
    </button>
  );
}

async function fetchTeacherCourses(publicSlug: string | null): Promise<DiscoveryCourseSummary[]> {
  if (!publicSlug) return [];
  const collected: DiscoveryCourseSummary[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_LOOKUP_PAGES; i++) {
    const page = await discoveryApi.listCourses({
      ...(cursor && { cursor }),
      pageSize: COURSE_LOOKUP_PAGE_SIZE,
    });
    for (const course of page.items) {
      if (course.teacher.publicSlug === publicSlug) collected.push(course);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return collected;
}
