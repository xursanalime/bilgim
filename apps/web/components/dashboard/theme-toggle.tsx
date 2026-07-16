'use client';

import { useRef } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme, type Theme } from '../providers/theme-provider';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: LucideIcon;
}

const OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Yorug‘ rejim', icon: Sun },
  { value: 'dark', label: 'Qorong‘i rejim', icon: Moon },
  { value: 'system', label: 'Tizim rejimi', icon: Monitor },
];

/**
 * Accessible light / dark / system theme switcher for the app shell.
 *
 * Rendered as a radio group so it is keyboard operable and announces the
 * active option to assistive tech. Each control carries an `aria-label`
 * (icon-only) and reflects selection via `aria-checked`.
 *
 * Follows the ARIA radiogroup pattern (Req 6.1): roving tabindex (only the
 * checked radio is in the Tab order) and arrow keys move focus + selection
 * between options, wrapping at the ends. Home/End jump to first/last.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  function selectAt(index: number) {
    const count = OPTIONS.length;
    const next = ((index % count) + count) % count;
    const option = OPTIONS[next];
    if (!option) return;
    setTheme(option.value);
    buttonsRef.current[next]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAt(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        break;
      case 'End':
        event.preventDefault();
        selectAt(OPTIONS.length - 1);
        break;
      default:
        break;
    }
  }

  // When no option matches (shouldn't happen), keep the first focusable so the
  // group is still reachable via Tab.
  const hasActive = OPTIONS.some((o) => o.value === theme);

  return (
    <div
      role="radiogroup"
      aria-label="Rang rejimi"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-rim bg-tint p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const active = theme === value;
        const tabbable = active || (!hasActive && index === 0);
        return (
          <button
            key={value}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => setTheme(value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-1',
              active
                ? 'bg-white text-blue shadow-sm dark:bg-white/10 dark:text-blue'
                : 'text-ink-soft hover:text-ink-strong',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
