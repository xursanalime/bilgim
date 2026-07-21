'use client';

import { useEffect, useRef } from 'react';

/**
 * LightPillar — Huly.io stilidagi vertikal yorug'lik ustuni.
 *
 * Markazdan tushuvchi yorqin nur, atrofida tuman, kichik zarrachalar.
 * Sichqoncha harakatiga ozgina parallax bilan javob beradi.
 *
 * Ko'rinishi:
 *   - Yuqoridan pastga oq-ko'k yorug'lik ustuni (linear-gradient)
 *   - Atrofida diffuz purple/blue glow (radial-gradient)
 *   - Kichik particle nuqtalari (canvas)
 *   - Pastki "ground" effekti — ustun yerga tushgan joyda yorug'lik
 */
export function LightPillar({
  hue = 'electric', // 'electric' | 'green'
  intensity = 1,
}: {
  hue?: 'electric' | 'green';
  intensity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hue → ranglar palitrasi
  const colors =
    hue === 'green'
      ? {
          pillarCore: 'rgba(0, 232, 122, 0.95)',
          pillarMid: 'rgba(0, 232, 122, 0.4)',
          pillarOuter: 'rgba(0, 232, 122, 0.08)',
          glowA: 'rgba(0, 232, 122, 0.25)',
          glowB: 'rgba(80, 200, 120, 0.18)',
          particle: 'rgba(180, 255, 220, 0.85)',
        }
      : {
          pillarCore: 'rgba(220, 230, 255, 0.95)',
          pillarMid: 'rgba(120, 140, 255, 0.45)',
          pillarOuter: 'rgba(80, 80, 200, 0.1)',
          glowA: 'rgba(100, 80, 220, 0.3)',
          glowB: 'rgba(60, 100, 200, 0.2)',
          particle: 'rgba(200, 215, 255, 0.9)',
        };

  // Particle animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let particles: {
      x: number;
      y: number;
      vy: number;
      r: number;
      a: number;
      life: number;
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
      // Particle near pillar center
      const centerX = width / 2;
      const offset = (Math.random() - 0.5) * 80;
      particles.push({
        x: centerX + offset,
        y: height + 10,
        vy: -0.5 - Math.random() * 1.2,
        r: 0.5 + Math.random() * 1.5,
        a: 0.3 + Math.random() * 0.5,
        life: 1,
      });
    };

    const tick = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // Spawn rate
      if (Math.random() < 0.5) spawn();

      particles = particles.filter((p) => p.life > 0 && p.y > -10);

      for (const p of particles) {
        p.y += p.vy;
        p.life -= 0.004;
        p.a = Math.max(0, p.a - 0.002);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = colors.particle.replace(
          /[\d.]+\)$/,
          `${p.a * p.life})`,
        );
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [colors.particle]);

  // Sichqoncha parallax
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const noHover = window.matchMedia('(hover: none)').matches;
    if (noHover) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const dx = (e.clientX - cx) / rect.width;
      el.style.setProperty('--tilt', `${dx * 8}deg`);
      el.style.setProperty('--shift', `${dx * 20}px`);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        opacity: intensity,
      }}
    >
      {/* Outer halo glow */}
      <div
        className="absolute left-1/2 top-1/4 h-[60%] w-[80%] -translate-x-1/2"
        style={{
          background: `radial-gradient(ellipse at center, ${colors.glowA} 0%, ${colors.glowB} 35%, transparent 75%)`,
          filter: 'blur(40px)',
          transform: `translateX(calc(-50% + var(--shift, 0px)))`,
          transition: 'transform 0.6s ease-out',
        }}
      />

      {/* Main vertical pillar */}
      <div
        className="absolute left-1/2 top-0 h-full w-[140px] -translate-x-1/2"
        style={{
          background: `linear-gradient(to right,
            transparent 0%,
            ${colors.pillarOuter} 20%,
            ${colors.pillarMid} 45%,
            ${colors.pillarCore} 50%,
            ${colors.pillarMid} 55%,
            ${colors.pillarOuter} 80%,
            transparent 100%)`,
          filter: 'blur(2px)',
          transform: `translateX(-50%) rotate(var(--tilt, 0deg))`,
          transformOrigin: 'top center',
          transition: 'transform 0.8s ease-out',
          mixBlendMode: 'screen',
        }}
      />

      {/* Inner bright core line */}
      <div
        className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2"
        style={{
          background: `linear-gradient(to bottom,
            transparent 0%,
            ${colors.pillarCore} 30%,
            ${colors.pillarCore} 70%,
            transparent 100%)`,
          boxShadow: `0 0 20px ${colors.pillarCore}, 0 0 40px ${colors.pillarMid}`,
          transform: `translateX(-50%) rotate(var(--tilt, 0deg))`,
          transformOrigin: 'top center',
          transition: 'transform 0.8s ease-out',
        }}
      />

      {/* Ground glow — pillar yerga tushgan joyda */}
      <div
        className="absolute bottom-0 left-1/2 h-[40%] w-[120%] -translate-x-1/2"
        style={{
          background: `radial-gradient(ellipse at top, ${colors.glowA} 0%, transparent 70%)`,
          filter: 'blur(20px)',
        }}
      />

      {/* Particles canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Subtle dot grid texture */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)',
          backgroundSize: '4px 4px',
          maskImage:
            'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        }}
      />
    </div>
  );
}
