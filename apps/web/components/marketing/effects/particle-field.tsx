'use client';

import { useEffect, useRef } from 'react';

/**
 * ParticleField — interaktiv canvas zarrachalar fon.
 *
 * Sichqoncha yaqinida zarrachalar harakatlanadi (parallax + repel).
 * Bir-biri bilan yaqin zarrachalar nozik chiziq bilan bog'lanadi.
 *
 * Performans:
 *   - Faqat ko'rinadigan ekran qismida ishlaydi (IntersectionObserver)
 *   - prefers-reduced-motion ni hurmat qiladi
 *   - DPR-aware HiDPI qo'llab-quvvatlash
 */
export function ParticleField({
  density = 60,
  color = 'rgba(120, 140, 255, 0.5)',
  linkColor = 'rgba(120, 140, 255, 0.15)',
  className = '',
}: {
  density?: number;
  color?: string;
  linkColor?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reduced motion — statik zarrachalar
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let visible = true;
    let mouse = { x: -9999, y: -9999, active: false };

    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let particles: P[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Re-initialize particles on resize
      const count = Math.min(
        density,
        Math.floor((width * height) / 18000),
      );
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 0.8 + Math.random() * 1.4,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };
    const onLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);

    // IntersectionObserver — pause when off-screen
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visible = e.isIntersecting;
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const tick = () => {
      if (!visible) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // Update particles
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;

          // Bounce on edges
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;

          // Mouse repel
          if (mouse.active) {
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 14400) {
              // 120^2
              const d = Math.sqrt(d2);
              const force = (120 - d) / 120;
              p.x += (dx / d) * force * 2;
              p.y += (dy / d) * force * 2;
            }
          }
        }

        // Draw
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Draw connections between close particles
      ctx.lineWidth = 0.7;
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]!;
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]!;
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 14400) {
            const alpha = 1 - d2 / 14400;
            ctx.strokeStyle = linkColor.replace(
              /[\d.]+\)$/,
              `${alpha * 0.3})`,
            );
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      io.disconnect();
    };
  }, [density, color, linkColor]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
