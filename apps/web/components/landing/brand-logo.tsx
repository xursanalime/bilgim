/**
 * BrandLogo — single source of truth for the Bilgim wordmark + icon.
 *
 * Used in the Aurora header, footer, and any other surface that needs
 * the brand identity. Renders a square gradient tile with a stylized
 * "open book / bridge" glyph.
 */
export function BrandMark({
  size = 36,
  className = '',
  glow = true,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  return (
    <span
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-2xl ${className}`}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(135deg, #667EEA 0%, #764BA2 50%, #AF52DE 100%)',
        boxShadow: glow
          ? '0 0 0 1px rgba(118, 75, 162, 0.25), 0 8px 24px -6px rgba(118, 75, 162, 0.45)'
          : 'none',
      }}
    >
      {/* Subtle inner highlight for the liquid glass feel */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 50%)',
        }}
      />
      {/* Glyph: open book + bridging stroke */}
      <svg
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative h-[58%] w-[58%] text-white"
        aria-hidden
      >
        {/* Left page */}
        <path
          d="M5 9 H11 a4 4 0 0 1 4 4 v12 a3 3 0 0 0 -3 -3 H5 z"
          strokeWidth="2.2"
          fill="rgba(255,255,255,0.18)"
        />
        {/* Right page */}
        <path
          d="M27 9 H21 a4 4 0 0 0 -4 4 v12 a3 3 0 0 1 3 -3 h7 z"
          strokeWidth="2.2"
          fill="rgba(255,255,255,0.18)"
        />
        {/* Bridge accent */}
        <path d="M11 16 H21" strokeWidth="2" />
        <circle cx="16" cy="16" r="1.5" fill="white" stroke="none" />
      </svg>
    </span>
  );
}

/**
 * Wordmark — full brand lockup with logo + text.
 */
export function BrandWordmark({
  size = 36,
  textClassName = 'text-base font-extrabold tracking-tight text-ink-strong sm:text-lg',
}: {
  size?: number;
  textClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={size} />
      <span className={textClassName} style={{ letterSpacing: '-0.025em' }}>
        Bilgim
      </span>
    </span>
  );
}
