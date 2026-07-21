/**
 * Loading skeletons for the public discovery pages (Task 25.5).
 *
 * Server-rendered placeholders shown during SSR streaming or
 * client-side navigation. All skeletons use the same card geometry as
 * the real components in `discovery-cards.tsx` so the layout doesn't
 * jump when results land.
 */

export function DiscoveryGridSkeleton({
  count = 6,
  variant = 'course',
}: {
  count?: number;
  variant?: 'course' | 'teacher';
}) {
  const cards = Array.from({ length: count });
  return (
    <ul
      role="status"
      aria-label="Yuklanmoqda"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {cards.map((_, i) =>
        variant === 'course' ? (
          <li key={i}>
            <CourseCardSkeleton />
          </li>
        ) : (
          <li key={i}>
            <TeacherCardSkeleton />
          </li>
        ),
      )}
    </ul>
  );
}

export function CourseCardSkeleton() {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="flex gap-2">
        <ShimmerPill width="3rem" />
        <ShimmerPill width="4.5rem" />
      </div>
      <ShimmerLine className="mt-4 h-5 w-3/4" />
      <ShimmerLine className="mt-2 h-4 w-full" />
      <ShimmerLine className="mt-1.5 h-4 w-5/6" />
      <ShimmerLine className="mt-1.5 h-4 w-2/3" />
      <div className="mt-auto flex items-center gap-3 border-t border-rim pt-4">
        <Shimmer className="h-9 w-9 flex-shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <ShimmerLine className="h-4 w-1/2" />
          <ShimmerLine className="mt-1.5 h-3 w-2/3" />
        </div>
      </div>
    </article>
  );
}

export function TeacherCardSkeleton() {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-canvas p-6 shadow-soft">
      <div className="flex items-start gap-4">
        <Shimmer className="h-14 w-14 flex-shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <ShimmerLine className="h-4 w-3/4" />
          <ShimmerLine className="mt-2 h-3 w-full" />
          <ShimmerLine className="mt-1.5 h-3 w-1/2" />
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <ShimmerPill width="6rem" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-rim pt-4">
        <ShimmerStat />
        <ShimmerStat />
        <ShimmerStat />
      </div>
      <Shimmer className="mt-6 h-10 w-full rounded-2xl" />
    </article>
  );
}

export function CourseDetailSkeleton() {
  return (
    <section role="status" aria-label="Yuklanmoqda" className="relative overflow-hidden">
      <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <ShimmerLine className="h-3 w-24" />
        <div className="mt-8 flex gap-2">
          <ShimmerPill width="3rem" />
          <ShimmerPill width="5rem" />
        </div>
        <ShimmerLine className="mt-5 h-10 w-2/3" />
        <Shimmer className="mt-8 h-64 w-full rounded-3xl" />
      </div>
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Shimmer className="h-44 w-full rounded-3xl" />
            <Shimmer className="h-32 w-full rounded-3xl" />
          </div>
          <Shimmer className="h-72 w-full rounded-3xl" />
        </div>
      </div>
    </section>
  );
}

export function TeacherProfileSkeleton() {
  return (
    <section role="status" aria-label="Yuklanmoqda" className="relative overflow-hidden">
      <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <ShimmerLine className="h-3 w-24" />
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <Shimmer className="h-24 w-24 flex-shrink-0 rounded-3xl" />
          <div className="flex-1">
            <ShimmerLine className="h-9 w-1/2" />
            <ShimmerLine className="mt-3 h-4 w-3/4" />
            <div className="mt-5 flex gap-2">
              <ShimmerPill width="6rem" />
              <ShimmerPill width="5rem" />
              <ShimmerPill width="5rem" />
            </div>
          </div>
        </div>
      </div>
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
          <ShimmerLine className="h-6 w-32" />
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <li>
              <CourseCardSkeleton />
            </li>
            <li>
              <CourseCardSkeleton />
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Primitives
// ──────────────────────────────────────────────────────────────────────

function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-soft ${className}`} />;
}

function ShimmerLine({ className = '' }: { className?: string }) {
  return <Shimmer className={`rounded-md ${className}`} />;
}

function ShimmerPill({ width }: { width: string }) {
  return (
    <span
      role="presentation"
      style={{ width }}
      className="inline-block h-5 animate-pulse rounded-full bg-soft"
    />
  );
}

function ShimmerStat() {
  return (
    <div>
      <ShimmerLine className="mx-auto h-4 w-8" />
      <ShimmerLine className="mx-auto mt-2 h-3 w-16" />
    </div>
  );
}
