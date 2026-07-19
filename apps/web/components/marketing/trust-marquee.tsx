/**
 * TrustMarquee — endlessly scrolling strip of subjects on dark theme.
 */
export function TrustMarquee() {
  const items = [
    'English',
    'Mathematics',
    'SMM & Marketing',
    'IELTS Preparation',
    'Programming',
    'Physics',
    'Chemistry',
    'Russian Language',
    'Korean Language',
    'Design',
    'Music',
    'Public Speaking',
  ];

  return (
    <div className="relative overflow-hidden border-y border-white/[0.07] bg-ink py-8">
      <div className="absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-ink to-transparent" />
      <div className="absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-ink to-transparent" />

      <div className="flex animate-marquee gap-12 whitespace-nowrap">
        {[...items, ...items].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-12 text-2xl font-extrabold tracking-tight text-cream-dim/40 sm:text-3xl"
            style={{ letterSpacing: '-0.02em' }}
          >
            <span>{item}</span>
            <svg
              className="h-5 w-5 flex-shrink-0 text-accent2-500/60"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L13.09 8.26L19.36 7.5L14.18 11.74L19.36 16.5L13.09 15.74L12 22L10.91 15.74L4.64 16.5L9.82 11.74L4.64 7.5L10.91 8.26L12 2Z" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
