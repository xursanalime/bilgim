'use client';

import { useEffect, useRef } from 'react';

import { prefersReducedMotion } from '../../../lib/use-prefers-reduced-motion';

/**
 * MorphingShape — Antimatter AI stilida particle-based 3D shape.
 *
 * Zarrachalardan tashkil topgan 3D figura, bir shakldan boshqasiga
 * smooth morph qiladi. Variantlar: cube, diamond, sphere, code (<>).
 *
 * Foydalanish:
 *   <MorphingShape variant={current} />  // 'cube' | 'diamond' | 'sphere' | 'code'
 */
export type ShapeVariant = 'cube' | 'diamond' | 'sphere' | 'code';

const PARTICLE_COUNT = 800;

interface ShapePoint {
  x: number;
  y: number;
  z: number;
}

function generateShape(variant: ShapeVariant): ShapePoint[] {
  const points: ShapePoint[] = [];

  switch (variant) {
    case 'cube': {
      // Wireframe cube — 12 ta qirra bo'ylab zarrachalar
      const size = 1.0;
      const edges: [ShapePoint, ShapePoint][] = [];
      const v = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      ];
      const e = [
        [0, 1], [1, 2], [2, 3], [3, 0], // back face
        [4, 5], [5, 6], [6, 7], [7, 4], // front face
        [0, 4], [1, 5], [2, 6], [3, 7], // connectors
      ] satisfies [number, number][];
      for (const [a, b] of e) {
        const va = v[a]!;
        const vb = v[b]!;
        edges.push([
          { x: va[0]! * size, y: va[1]! * size, z: va[2]! * size },
          { x: vb[0]! * size, y: vb[1]! * size, z: vb[2]! * size },
        ]);
      }

      const perEdge = Math.floor(PARTICLE_COUNT / edges.length);
      for (const [start, end] of edges) {
        for (let i = 0; i < perEdge; i++) {
          const t = i / perEdge;
          points.push({
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
            z: start.z + (end.z - start.z) * t,
          });
        }
      }
      break;
    }

    case 'diamond': {
      // Diamond = ikki tetrahedron (yuqori va past piramida)
      const top: ShapePoint = { x: 0, y: -1.2, z: 0 };
      const bottom: ShapePoint = { x: 0, y: 1.2, z: 0 };
      const middle: ShapePoint[] = [
        { x: -1, y: 0, z: -1 },
        { x: 1, y: 0, z: -1 },
        { x: 1, y: 0, z: 1 },
        { x: -1, y: 0, z: 1 },
      ];

      const edges: [ShapePoint, ShapePoint][] = [];
      // Top to middle
      for (const m of middle) edges.push([top, m]);
      // Middle ring
      for (let i = 0; i < middle.length; i++) {
        edges.push([middle[i]!, middle[(i + 1) % middle.length]!]);
      }
      // Bottom to middle
      for (const m of middle) edges.push([bottom, m]);

      const perEdge = Math.floor(PARTICLE_COUNT / edges.length);
      for (const [start, end] of edges) {
        for (let i = 0; i < perEdge; i++) {
          const t = i / perEdge;
          points.push({
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
            z: start.z + (end.z - start.z) * t,
          });
        }
      }
      break;
    }

    case 'sphere': {
      // Fibonacci sphere distribution
      const golden = Math.PI * (3 - Math.sqrt(5));
      const r = 1.1;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const theta = golden * i;
        points.push({
          x: Math.cos(theta) * radius * r,
          y: y * r,
          z: Math.sin(theta) * radius * r,
        });
      }
      break;
    }

    case 'code': {
      // < > shape — chap va o'ng burchak qavslar
      const z = 0;
      const segments = [
        // Left bracket "<"
        [{ x: -0.3, y: -0.8, z }, { x: -1.0, y: 0.0, z }],
        [{ x: -1.0, y: 0.0, z }, { x: -0.3, y: 0.8, z }],
        // Right bracket ">"
        [{ x: 0.3, y: -0.8, z }, { x: 1.0, y: 0.0, z }],
        [{ x: 1.0, y: 0.0, z }, { x: 0.3, y: 0.8, z }],
        // Slash "/" between them
        [{ x: -0.2, y: 0.6, z: 0.2 }, { x: 0.2, y: -0.6, z: -0.2 }],
      ];

      const perEdge = Math.floor(PARTICLE_COUNT / segments.length);
      for (const [start, end] of segments) {
        for (let i = 0; i < perEdge; i++) {
          const t = i / perEdge;
          points.push({
            x: start!.x + (end!.x - start!.x) * t,
            y: start!.y + (end!.y - start!.y) * t,
            z: start!.z + (end!.z - start!.z) * t,
          });
        }
      }
      break;
    }
  }

  // Pad to PARTICLE_COUNT
  while (points.length < PARTICLE_COUNT) {
    points.push({ x: 0, y: 0, z: 0 });
  }
  return points.slice(0, PARTICLE_COUNT);
}

export function MorphingShape({
  variant,
  color = 'rgba(180, 200, 255, 0.85)',
  size = 360,
}: {
  variant: ShapeVariant;
  color?: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetShape = useRef<ShapePoint[]>(generateShape(variant));
  const currentShape = useRef<ShapePoint[]>(generateShape(variant));

  // When variant changes, set new target
  useEffect(() => {
    targetShape.current = generateShape(variant);
  }, [variant]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = prefersReducedMotion();

    let raf = 0;
    let rotation = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const tick = () => {
      ctx.clearRect(0, 0, size, size);

      if (!reduced) rotation += 0.005;

      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const cx = size / 2;
      const cy = size / 2;
      const scale = size * 0.32;

      // Lerp shapes
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const target = targetShape.current[i]!;
        const cur = currentShape.current[i]!;
        cur.x += (target.x - cur.x) * 0.08;
        cur.y += (target.y - cur.y) * 0.08;
        cur.z += (target.z - cur.z) * 0.08;
      }

      // Render — sort by depth for fake 3D
      const projected = currentShape.current.map((p, i) => {
        // Y-axis rotation
        const x = p.x * cos - p.z * sin;
        const z = p.x * sin + p.z * cos;
        // Perspective
        const persp = 1 / (1 + z * 0.4);
        return {
          i,
          x: cx + x * scale * persp,
          y: cy + p.y * scale * persp,
          z,
          alpha: persp,
        };
      });

      projected.sort((a, b) => a.z - b.z);

      for (const p of projected) {
        const baseAlpha = (p.alpha - 0.4) * 1.5;
        if (baseAlpha <= 0) continue;

        // Add jitter for sparkle effect
        const jitter = (Math.random() - 0.5) * 1.2;
        const px = p.x + jitter;
        const py = p.y + jitter;

        ctx.beginPath();
        ctx.arc(px, py, 1.2 * p.alpha, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(/[\d.]+\)$/, `${baseAlpha * 0.85})`);
        ctx.fill();

        // Glow halo on closer particles
        if (p.alpha > 0.8) {
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(/[\d.]+\)$/, `${baseAlpha * 0.15})`);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [size, color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size, height: size }}
      className="block"
    />
  );
}
