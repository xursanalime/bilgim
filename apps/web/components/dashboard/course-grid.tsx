'use client';

import Link from 'next/link';
import { BookOpen, Pencil, Signal, Users, Layers, ArrowRight } from 'lucide-react';
import type { Course } from '../../lib/api/catalog';
import { cn } from '../../lib/utils';

interface CourseGridProps {
  courses: Course[];
  locale: string;
}

export function CourseGrid({ courses, locale }: CourseGridProps) {
  if (courses.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-tint/30 p-12 text-center transition-colors hover:bg-tint/50">
        <div className="relative mb-6">
          <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-blue/10 text-blue shadow-sm">
            <BookOpen className="h-10 w-10" />
          </div>
        </div>
        <h3 className="font-display text-xl font-extrabold text-ink-strong">
          Kurslaringiz hozircha bo'sh
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          Talabalaringiz uchun birinchi ajoyib kursni yarating va ularga ingliz tilini o'rgatishni boshlang.
        </p>
        <Link
          href={`/${locale}/dashboard/courses/new`}
          className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-blue px-8 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          Birinchi kursni yarating
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map((course) => (
        <div key={course.id} className="group relative">
          {/* The edit shortcut sits outside the card link: an interactive
              element nested inside an <a> is invalid HTML, and the previous
              "⋮" button swallowed nothing — it had no handler, so clicking it
              just navigated to the course like the rest of the card. */}
          <Link
            href={`/${locale}/dashboard/courses/${course.id}/edit`}
            aria-label={`${course.title} — tahrirlash`}
            className="absolute right-6 top-6 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint opacity-0 transition-all hover:bg-tint hover:text-blue focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>

          <Link
            href={`/${locale}/dashboard/courses/${course.id}`}
            className="flex h-full flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] hover:border-blue/20"
          >
            {/* Card Header: Level & Status */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 items-center rounded-full bg-blue/5 px-2.5 text-[10px] font-bold uppercase tracking-wider text-blue border border-blue/10">
                  {course.level || 'Barcha darajalar'}
                </span>
                {course.isPublished ? (
                  <span className="flex h-6 items-center rounded-full bg-teal/5 px-2.5 text-[10px] font-bold uppercase tracking-wider text-teal border border-teal/10">
                    <Signal className="mr-1 h-2.5 w-2.5 animate-pulse" />
                    Nashrda
                  </span>
                ) : (
                  <span className="flex h-6 items-center rounded-full bg-tint px-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint border border-rim">
                    Qoralama
                  </span>
                )}
              </div>
            </div>

            {/* Title & Description */}
            <div className="mt-5 flex-1 space-y-2">
              <h3 className="font-display text-lg font-extrabold leading-tight text-ink-strong group-hover:text-blue transition-colors line-clamp-2">
                {course.title}
              </h3>
              {course.description && (
                <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
                  {course.description}
                </p>
              )}
            </div>

            {/* Stats / Info */}
            <div className="mt-auto flex items-center justify-between border-t border-rim pt-5">
              {/* These read 0 for every course until the list endpoint started
                  returning counts — they were literal zeros in the markup. */}
              <div className="flex items-center gap-4 text-xs font-bold text-ink-soft">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 opacity-50 text-blue" />
                  <span>{course.studentCount ?? 0} talaba</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 opacity-50 text-purple" />
                  <span>{course.groupCount ?? 0} guruh</span>
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/5 text-blue transition-all group-hover:bg-blue group-hover:text-white group-hover:shadow-blue-soft">
                <ArrowRight className="h-4.5 w-4.5" />
              </div>
            </div>
          </Link>
        </div>
      ))}
    </div>
  );
}
