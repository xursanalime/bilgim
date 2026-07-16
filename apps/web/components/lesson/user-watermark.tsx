'use client';

import { useEffect, useState } from 'react';
import { getCurrentUser } from '../../lib/auth';

/** Mask an email so it can't be read off-screen (fallback for old tokens). */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'viewer';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/**
 * UserWatermark — video ustiga foydalanuvchi identifikatorini chiqaradi.
 *
 * Maqsad: kontent sizib chiqsa kim qilganini aniqlash imkonini beradi.
 * Watermark pozitsiyasi har 8 sekundda siljiydi — screenshot qilish
 * qiyinlashadi.
 */
export function UserWatermark() {
  const [label, setLabel] = useState('');
  const [pos, setPos] = useState({ top: '10%', left: '10%' });

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      const date = new Date().toLocaleDateString('uz-UZ');
      // Prefer the 6-digit publicId; fall back to a masked email for tokens
      // minted before the publicId claim existed (so it never breaks).
      const identity = user.publicId
        ? `ID: ${user.publicId}`
        : maskEmail(user.email);
      setLabel(`${identity} • ${date}`);
    }
  }, []);

  // Watermark pozitsiyasini har 8 sekundda siljit
  useEffect(() => {
    const positions = [
      { top: '8%', left: '8%' },
      { top: '8%', left: '55%' },
      { top: '45%', left: '8%' },
      { top: '45%', left: '55%' },
      { top: '78%', left: '8%' },
      { top: '78%', left: '55%' },
    ];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % positions.length;
      setPos(positions[idx]!);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  if (!label) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 10,
        opacity: 0.30,
        transform: 'rotate(-25deg)',
        transition: 'top 1s ease, left 1s ease',
        whiteSpace: 'nowrap',
        fontSize: '13px',
        fontWeight: 700,
        fontFamily: 'monospace',
        color: '#ffffff',
        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </div>
  );
}
