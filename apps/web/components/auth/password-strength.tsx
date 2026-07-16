'use client';

import { motion } from 'framer-motion';
import { passwordStrength } from '../../lib/validation/auth-schemas';

interface PasswordStrengthProps {
  password: string;
}

const colorByScore = [
  'bg-forest-800/10', // empty
  'bg-red-500',
  'bg-orange-400',
  'bg-gold-400',
  'bg-forest-400',
];

const labelByScore: Record<number, string> = {
  0: 'Parol kiriting',
  1: 'Zaif',
  2: 'O‘rta',
  3: 'Yaxshi',
  4: 'Kuchli',
};

/**
 * PasswordStrength — 4-bar visual meter that reflects the
 * `passwordStrength()` score from the validation module.
 */
export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { score, label } = passwordStrength(password);
  const showLabel = label !== 'empty';

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((bar) => {
          const active = score >= bar;
          return (
            <motion.div
              key={bar}
              initial={false}
              animate={{ opacity: active ? 1 : 0.4 }}
              transition={{ duration: 0.2 }}
              className={`h-1.5 flex-1 rounded-full ${
                active ? colorByScore[score] : 'bg-forest-800/10'
              }`}
            />
          );
        })}
      </div>
      <p
        className={`mt-1 text-[11px] font-medium ${
          showLabel ? 'text-forest-700/80' : 'text-forest-700/50'
        }`}
      >
        Parol kuchi: <span className="font-bold">{labelByScore[score]}</span>
      </p>
    </div>
  );
}
