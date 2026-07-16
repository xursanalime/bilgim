'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface AuthFormCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * AuthFormCard — wrapper card used by every auth page.
 * Shows the title, optional description, the form (children) and a footer slot.
 */
export function AuthFormCard({
  title,
  description,
  children,
  footer,
  className = '',
}: AuthFormCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`w-full max-w-md rounded-3xl border border-forest-800/10 bg-white/90 p-8 shadow-xl shadow-forest-800/10 backdrop-blur-sm sm:p-10 ${className}`}
    >
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-forest-800 sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm text-forest-700/70">{description}</p>
        ) : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-6 border-t border-forest-800/10 pt-5 text-center text-sm text-forest-700/80">
          {footer}
        </div>
      ) : null}
    </motion.div>
  );
}
