export default function TeacherProfileLoading() {
  return (
    <section role="status" aria-label="Yuklanmoqda" className="relative overflow-hidden">
      <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <div className="h-3 w-24 animate-pulse rounded-md bg-soft" />
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="h-24 w-24 flex-shrink-0 animate-pulse rounded-3xl bg-soft" />
          <div className="flex-1 space-y-3">
            <div className="h-9 w-1/2 animate-pulse rounded-md bg-soft" />
            <div className="h-4 w-3/4 animate-pulse rounded-md bg-soft" />
            <div className="flex gap-2 pt-2">
              <div className="h-5 w-24 animate-pulse rounded-full bg-soft" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-soft" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-soft" />
            </div>
          </div>
        </div>
      </div>
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
          <div className="h-6 w-32 animate-pulse rounded-md bg-soft" />
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-40 animate-pulse rounded-2xl border border-rim bg-tint" />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
