'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Table — semantic, styled table primitives (sort/filter/paginate are
// driven by the consumer; this provides the building blocks + an
// accessible sortable header button). Wrapped for horizontal scroll.
// ═════════════════════════════════════════════════════════════════

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto rounded-2xl border border-rim">
      <table
        ref={ref}
        className={cn('w-full caption-bottom border-collapse text-sm', className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-tint', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-rim', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t border-rim bg-tint font-medium', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-rim transition-colors hover:bg-tint/60', className)}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      'h-12 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-ink-soft',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 align-middle text-ink-strong', className)} {...props} />
));
TableCell.displayName = 'TableCell';

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-ink-soft', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

// ─────────────────────────────────────────────────────────────────
// Sortable header button — sets aria-sort on the parent <th>.
// ─────────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc' | false;

export interface SortableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sorted: SortDirection;
  onSort: () => void;
}

export function SortableHead({
  sorted,
  onSort,
  className,
  children,
  ...props
}: SortableHeadProps) {
  const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'h-12 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-ink-soft',
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1.5 rounded-md outline-none transition-colors hover:text-ink-strong focus-visible:ring-2 focus-visible:ring-blue"
      >
        {children}
        {sorted === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : sorted === 'desc' ? (
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}
