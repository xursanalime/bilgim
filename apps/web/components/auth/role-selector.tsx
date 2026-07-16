'use client';

import { motion } from 'framer-motion';

type Role = 'STUDENT' | 'TEACHER';

interface RoleSelectorProps {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean | undefined;
}

/**
 * RoleSelector — segmented control with an animated pill that slides
 * between "Talaba" and "O'qituvchi". Mirrors the marketing role-switcher.
 */
const ROLES: readonly Role[] = ['STUDENT', 'TEACHER'];

export function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
  const isTeacher = value === 'TEACHER';

  // WAI-ARIA radio-group keyboard pattern: arrow keys move focus AND selection
  // between the radios (Req 6.1). Roving tabindex keeps a single Tab stop.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }
    const isForward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const isBackward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!isForward && !isBackward) {
      return;
    }
    event.preventDefault();
    const currentIndex = ROLES.indexOf(value);
    const delta = isForward ? 1 : -1;
    const nextIndex = (currentIndex + delta + ROLES.length) % ROLES.length;
    const nextRole = ROLES[nextIndex];
    if (nextRole && nextRole !== value) {
      onChange(nextRole);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Rolni tanlang"
      className="relative grid grid-cols-2 rounded-2xl border border-forest-800/15 bg-white p-1 shadow-sm"
    >
      <motion.div
        aria-hidden
        className="absolute inset-y-1 w-1/2 rounded-xl bg-forest-800 shadow-md"
        initial={false}
        animate={{ x: isTeacher ? '100%' : '0%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        style={{ left: '0.25rem', width: 'calc(50% - 0.25rem)' }}
      />

      <RoleButton
        active={!isTeacher}
        disabled={disabled}
        onClick={() => onChange('STUDENT')}
        onKeyDown={handleKeyDown}
        label="Talaba"
        sub="Bilim olaman"
        icon={<StudentIcon />}
      />
      <RoleButton
        active={isTeacher}
        disabled={disabled}
        onClick={() => onChange('TEACHER')}
        onKeyDown={handleKeyDown}
        label="O'qituvchi"
        sub="O'rgataman"
        icon={<TeacherIcon />}
      />
    </div>
  );
}

function RoleButton({
  active,
  disabled,
  onClick,
  onKeyDown,
  label,
  sub,
  icon,
}: {
  active: boolean;
  disabled?: boolean | undefined;
  onClick: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  label: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      // Roving tabindex: only the selected radio is in the Tab order; arrow
      // keys move within the group (Req 5.2, 6.1).
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`relative z-10 flex flex-col items-center gap-0.5 rounded-xl px-4 py-3 text-sm font-bold transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'text-pomelo-100'
          : 'text-forest-800 hover:text-forest-700'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-4">{icon}</span>
        {label}
      </span>
      <span
        className={`text-[11px] font-medium tracking-wide ${
          active ? 'text-pomelo-100/80' : 'text-forest-700/60'
        }`}
      >
        {sub}
      </span>
    </button>
  );
}

function StudentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function TeacherIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
