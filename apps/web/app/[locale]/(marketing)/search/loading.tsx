import { DiscoveryGridSkeleton } from '../../../../components/marketing/discovery-skeletons';

/**
 * Streaming fallback for `/[locale]/search` (Task 25.5).
 *
 * Next.js renders this immediately while the Server Component fetches
 * `/discovery/{teachers,courses}` from the API. The skeleton mirrors
 * the real grid layout so the page doesn't shift when results land.
 */
export default function SearchLoading() {
  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Qidiruv
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
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
