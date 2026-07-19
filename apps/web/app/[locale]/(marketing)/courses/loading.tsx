import { DiscoveryGridSkeleton } from '../../../../components/marketing/discovery-skeletons';

export default function CoursesLoading() {
  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Kurslar
          </span>
          <h1
            className="mt-4 font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              letterSpacing: '-0.04em',
            }}
          >
            Yuklanmoqda...
          </h1>
        </header>
        <div className="mt-10">
          <DiscoveryGridSkeleton count={6} variant="course" />
        </div>
      </div>
    </section>
  );
}
