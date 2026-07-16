'use client';

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Tabs — WAI-ARIA tabs pattern. role=tablist/tab/tabpanel, roving
// tabindex, ArrowLeft/ArrowRight/Home/End navigation, controlled or
// uncontrolled. Variants: line | pill.
// ═════════════════════════════════════════════════════════════════

type TabsVariant = 'line' | 'pill';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
  variant: TabsVariant;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Tabs>`);
  return ctx;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: TabsVariant;
  children: ReactNode;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  variant = 'line',
  className,
  children,
  ...props
}: TabsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  const current = isControlled ? value : internal;
  const baseId = useId();

  const setValue = (v: string) => {
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
  };

  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId, variant }}>
      <div className={cn('flex flex-col gap-4', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { variant } = useTabs('TabsList');
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    if (tabs.length === 0) return;
    const activeIndex = tabs.findIndex((t) => t === document.activeElement);
    e.preventDefault();
    let next = activeIndex;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    tabs[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1',
        variant === 'line' && 'border-b border-rim',
        variant === 'pill' && 'rounded-2xl bg-tint p-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  disabled?: boolean;
}

export function TabsTrigger({
  value,
  disabled,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const { value: current, setValue, baseId, variant } = useTabs('TabsTrigger');
  const selected = current === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'line' &&
          cn(
            '-mb-px border-b-2 px-4 py-2.5',
            selected
              ? 'border-blue text-blue'
              : 'border-transparent text-ink-soft hover:text-ink-strong',
          ),
        variant === 'pill' &&
          cn(
            'rounded-xl px-4 py-2',
            selected
              ? 'bg-canvas text-ink-strong shadow-soft'
              : 'text-ink-soft hover:text-ink-strong',
          ),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const { value: current, baseId } = useTabs('TabsContent');
  const selected = current === value;
  if (!selected) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('outline-none focus-visible:ring-2 focus-visible:ring-blue', className)}
      {...props}
    >
      {children}
    </div>
  );
}
