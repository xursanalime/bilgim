import Link from 'next/link';
import { ClipboardList, Plus, Users } from 'lucide-react';

import type { AssignmentWithModules } from '../../lib/api/homework';
import { MODULE_TYPE_LABELS } from '../homework/module-type-labels';

interface LessonAssignmentsProps {
  assignments: AssignmentWithModules[];
  locale: string;
  courseId: string;
  groupId: string;
  lessonId: string;
  /** Set when the list could not be fetched; shown instead of the empty state. */
  loadError?: string | null;
}

/**
 * Homework attached to a lesson.
 *
 * The lesson page had no assignment surface at all: a teacher looking at a
 * lesson could not see what homework it carried, and creating some meant
 * going to the builder and re-picking course → group → lesson by hand. The
 * "new" button deep-links all three so the builder opens pre-filled.
 */
export function LessonAssignments({
  assignments,
  locale,
  courseId,
  groupId,
  lessonId,
  loadError,
}: LessonAssignmentsProps) {
  const lessonHref = `/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lessonId}`;
  const newHref =
    `/${locale}/homework/new` +
    `?courseId=${courseId}&groupId=${groupId}&lessonId=${lessonId}` +
    `&returnTo=${encodeURIComponent(lessonHref)}`;

  return (
    <section className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-tint text-blue">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-base font-extrabold tracking-tight text-ink-strong">
              Uy vazifalari
            </h2>
            <p className="text-xs text-ink-soft">
              {assignments.length === 0
                ? 'Bu darsga vazifa biriktirilmagan'
                : `${assignments.length} ta vazifa`}
            </p>
          </div>
        </div>

        <Link
          href={newHref}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-blue px-4 text-xs font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Yangi vazifa
        </Link>
      </div>

      {loadError ? (
        <p className="mt-5 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
          Vazifalarni yuklab bo&apos;lmadi: {loadError}
        </p>
      ) : assignments.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-rim bg-tint/40 px-5 py-8 text-center text-sm text-ink-soft">
          Talabalar mustaqil ishlashi uchun shu darsga vazifa qo&apos;shing.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${locale}/homework/${a.id}?returnTo=${encodeURIComponent(lessonHref)}`}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-rim bg-white p-4 transition-all hover:border-blue/20 hover:shadow-soft"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        a.isPublished
                          ? 'rounded-full bg-teal-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal'
                          : 'rounded-full bg-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint'
                      }
                    >
                      {a.isPublished ? 'Nashrda' : 'Qoralama'}
                    </span>
                    {a.modules.map((m) => (
                      <span
                        key={m.id}
                        className="rounded-full bg-blue/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue"
                      >
                        {MODULE_TYPE_LABELS[m.type] ?? m.type}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-bold text-ink-strong transition-colors group-hover:text-blue">
                    {a.title}
                  </p>
                  {a.dueAt && (
                    <p className="mt-0.5 text-[11px] font-medium text-ink-faint">
                      Muddat: {new Date(a.dueAt).toLocaleDateString('uz-UZ')}
                    </p>
                  )}
                </div>

                <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-ink-soft">
                  <Users className="h-3.5 w-3.5 text-blue opacity-60" />
                  {a.totalPoints} ball
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
