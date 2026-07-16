import { LoadingState } from '../../../../components/states';

export default function TeachersLoading() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Ustozlar
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
            Yuklanmoqda...
          </h1>
        </header>
        <div className="mt-10">
          <LoadingState variant="card" count={6} label="Ustozlar yuklanmoqda" />
        </div>
      </div>
    </section>
  );
}
