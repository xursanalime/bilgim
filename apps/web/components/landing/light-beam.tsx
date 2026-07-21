'use client';

import { useEffect, useRef } from 'react';

/**
 * LightBeam — signature vertical light pillar (Aurora Dawn palette).
 *
 * Light, fresh tones: sky blue → lavender → mint, with cream core.
 */
export function LightBeam({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mouse parallax
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const noHover = window.matchMedia('(hover: none)').matches;
    if (noHover) return;

    let raf = 0;
    const target = { x: 0 };
    const current = { x: 0 };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      target.x = (e.clientX - cx) / rect.width;
    };

    const tick = () => {
      current.x += (target.x - current.x) * 0.06;
      el.style.setProperty('--tilt', `${current.x * 4}deg`);
      el.style.setProperty('--shift', `${current.x * 30}px`);
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Light dust particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let raf = 0;
    let particles: {
      x: number;
      y: number;
      vy: number;
      r: number;
      a: number;
    }[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const spawn = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const centerX = width / 2;
      const offset = (Math.random() - 0.5) * 140;
      particles.push({
        x: centerX + offset,
        y: height + 8,
        vy: -0.4 - Math.random() * 1.6,
        r: 0.4 + Math.random() * 1.6,
        a: 0.3 + Math.random() * 0.5,
      });
    };

    const tick = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      if (Math.random() < 0.7) spawn();
      if (Math.random() < 0.7) spawn();

      particles = particles.filter((p) => p.y > -20 && p.a > 0.02);

      for (const p of particles) {
        p.y += p.vy;
        p.a -= 0.0025;

        const centerX = width / 2;
        p.x += (centerX - p.x) * 0.0015;

        // Brand colors: violet bottom → emerald top
        const norm = 1 - p.y / height;
        let color: string;
        if (norm < 0.6) {
          color = `rgba(124, 58, 237, ${Math.min(p.a * 1.5, 0.9)})`; // violet
        } else {
          color = `rgba(16, 185, 129, ${Math.min(p.a * 1.5, 0.8)})`; // emerald
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (p.a > 0.4) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(/[\d.]+\)$/, `${p.a * 0.25})`);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {/* ── Atmospheric haze (Brand Saturated) ──────────────── */}
      <div
        className="absolute left-1/2 top-[-10%] h-[140%] w-[80vw] -translate-x-1/2"
        style={{
          background: `
            radial-gradient(ellipse 50% 60% at 50% 30%,
              rgba(16, 185, 129, 0.22) 0%,
              transparent 65%),
            radial-gradient(ellipse 40% 50% at 50% 50%,
              rgba(124, 58, 237, 0.25) 0%,
              transparent 65%),
            radial-gradient(ellipse 60% 40% at 50% 75%,
              rgba(99, 102, 241, 0.28) 0%,
              transparent 70%)
          `,
          filter: 'blur(50px)',
          transform: 'translateX(calc(-50% + var(--shift, 0px)))',
          transition: 'transform 0.8s cubic-bezier(0.45, 0, 0.55, 1)',
        }}
      />

      {/* ── Outer ray bloom ──────────────────────────────── */}
      <div
        className="absolute left-1/2 top-0 h-full w-[320px] -translate-x-1/2"
        style={{
          background: `linear-gradient(to right,
            transparent 0%,
            rgba(16, 185, 129, 0.12) 15%,
            rgba(124, 58, 237, 0.35) 40%,
            rgba(255, 255, 255, 0.65) 50%,
            rgba(99, 102, 241, 0.35) 60%,
            rgba(16, 185, 129, 0.12) 85%,
            transparent 100%)`,
          filter: 'blur(12px)',
          transform: 'translateX(-50%) rotate(var(--tilt, 0deg))',
          transformOrigin: 'top center',
          transition: 'transform 0.8s cubic-bezier(0.45, 0, 0.55, 1)',
          mixBlendMode: 'hard-light',
          animation: 'beam-breathe 8s ease-in-out infinite',
        }}
      />

      {/* ── Mid ray ──────────────────────────────────────── */}
      <div
        className="absolute left-1/2 top-0 h-full w-[100px] -translate-x-1/2"
        style={{
          background: `linear-gradient(to right,
            transparent 0%,
            rgba(124, 58, 237, 0.5) 30%,
            rgba(255, 255, 255, 1) 50%,
            rgba(99, 102, 241, 0.5) 70%,
            transparent 100%)`,
          filter: 'blur(3px)',
          transform: 'translateX(-50%) rotate(var(--tilt, 0deg))',
          transformOrigin: 'top center',
          transition: 'transform 0.8s cubic-bezier(0.45, 0, 0.55, 1)',
          mixBlendMode: 'hard-light',
          animation: 'beam-breathe 8s ease-in-out 1s infinite',
        }}
      />

      {/* ── Bright core ──────────────────────────────────── */}
      <div
        className="absolute left-1/2 top-0 h-full w-[4px] -translate-x-1/2"
        style={{
          background: `linear-gradient(to bottom,
            transparent 0%,
            rgba(124, 58, 237, 0.9) 8%,
            rgba(255, 255, 255, 1) 50%,
            rgba(16, 185, 129, 0.8) 85%,
            transparent 100%)`,
          boxShadow: `
            0 0 10px rgba(124, 58, 237, 0.8),
            0 0 35px rgba(99, 102, 241, 0.5),
            0 0 85px rgba(16, 185, 129, 0.3)
          `,
          transform: 'translateX(-50%) rotate(var(--tilt, 0deg))',
          transformOrigin: 'top center',
          transition: 'transform 0.8s cubic-bezier(0.45, 0, 0.55, 1)',
          animation: 'beam-breathe 8s ease-in-out infinite',
        }}
      />

      {/* ── Top sparkle ──────────────────────────────────── */}
      <div
        className="absolute left-1/2 top-[-2%] h-36 w-36 -translate-x-1/2"
        style={{
          background: `radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(124, 58, 237, 0.45) 30%, transparent 70%)`,
          filter: 'blur(8px)',
          animation: 'beam-pulse 4s ease-in-out infinite',
        }}
      />

      {/* ── Ground reflection (EduBridge brand colors) ───── */}
      <div className="absolute inset-x-0 bottom-0 h-[45%] overflow-hidden">
        <div
          className="absolute left-1/2 top-0 h-full w-[160%] -translate-x-1/2"
          style={{
            background: `radial-gradient(ellipse at top,
              rgba(124, 58, 237, 0.45) 0%,
              rgba(99, 102, 241, 0.32) 25%,
              rgba(16, 185, 129, 0.22) 50%,
              transparent 75%)`,
            filter: 'blur(25px)',
          }}
        />

        <div
          className="absolute left-1/2 top-0 h-[60%] w-[40%] -translate-x-1/2"
          style={{
            background: `radial-gradient(ellipse at top,
              rgba(255, 255, 255, 0.6) 0%,
              rgba(124, 58, 237, 0.4) 15%,
              transparent 60%)`,
            filter: 'blur(15px)',
          }}
        />

        <div className="absolute bottom-0 left-1/2 h-[2px] w-[70%] -translate-x-1/2 bg-gradient-to-r from-transparent via-violet/60 to-transparent blur-sm" />
      </div>

      {/* ── Particles ────────────────────────────────────── */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* ── Texture ──────────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(rgba(124, 58, 237, 0.25) 1px, transparent 1px)',
          backgroundSize: '4px 4px',
          maskImage:
            'radial-gradient(ellipse 50% 60% at 50% 50%, black 0%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 50% 60% at 50% 50%, black 0%, transparent 70%)',
          opacity: 0.35,
        }}
      />

      <style jsx>{`
        @keyframes beam-pulse {
          0%, 100% {
            opacity: 0.7;
            transform: translateX(-50%) scale(1);
          }
          50% {
            opacity: 1;
            transform: translateX(-50%) scale(1.25);
          }
        }
        @keyframes beam-breathe {
          0%, 100% { 
            opacity: 0.6; 
            transform: translateX(-50%) rotate(var(--tilt, 0deg)) scaleX(1); 
          }
          50% { 
            opacity: 1;   
            transform: translateX(-50%) rotate(var(--tilt, 0deg)) scaleX(1.2); 
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .absolute {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
