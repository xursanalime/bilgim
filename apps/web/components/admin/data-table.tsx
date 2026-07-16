'use client';

import { ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import {
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/utils';
import { ErrorState } from '../states/error-state';
import { LoadingState } from '../states/loading-state';
import { EmptyState } from '../states/empty-state';
import { Input } from '../ui/input';
import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type SortDirection,
} from '../ui/table';

// ═════════════════════════════════════════════════════════════════
// Admin data-table (task 13.2, Req 17.3)
//
// A reusable management table that provides a consistent pattern across
// every admin surface: client-side text filtering, sortable columns, and
// pagination, plus first-class loading / error / empty states (composed
// from the shared `components/states` primitives) and an optional row
// actions column for destructive confirms.
//
// The sort / filter / paginate logic is split into pure, side-effect-free
// helpers (`filterRows`, `sortRows`, `paginate`) so it can be unit-tested
// in isolation (see `data-table.spec.ts`).
// ═════════════════════════════════════════════════════════════════

/** Primitive value a column can expose for sorting / text filtering. */
export type CellValue = string | number | boolean | null | undefined;

export type SortDir = 'asc' | 'desc';

export interface DataTableColumn<T> {
  /** Stable column id (used as the sort key and React key). */
  id: string;
  /** Header label / node. */
  header: ReactNode;
  /**
   * Extracts the sortable + filterable value for a row. Required for a
   * column to participate in sorting or text filtering.
   */
  accessor?: (row: T) => CellValue;
  /** Custom cell renderer. Falls back to the stringified accessor value. */
  cell?: (row: T) => ReactNode;
  /** Enable the sortable header button. Requires `accessor`. */
  sortable?: boolean;
  /** Include this column's accessor value in the free-text filter (default: true when an accessor exists). */
  filterable?: boolean;
  /** Horizontal alignment of the cell content. */
  align?: 'left' | 'right' | 'center';
  /** Extra classes for the body cell. */
  className?: string;
}

export interface DataTableLabels {
  filterPlaceholder: string;
  /** sr-only label for the filter input. */
  filterLabel: string;
  /** `(page, totalPages) => string` page indicator. */
  pageStatus: (page: number, totalPages: number) => string;
  /** `(shown, total) => string` results count. */
  resultCount: (shown: number, total: number) => string;
  previousPage: string;
  nextPage: string;
  emptyTitle: string;
  emptyDescription?: string;
  errorTitle: string;
  retryLabel: string;
  loadingLabel: string;
}

const DEFAULT_LABELS: DataTableLabels = {
  filterPlaceholder: 'Qidirish...',
  filterLabel: 'Jadvalni filtrlash',
  pageStatus: (page, totalPages) => `Sahifa ${page} / ${totalPages}`,
  resultCount: (shown, total) => `${shown} / ${total} ta natija`,
  previousPage: 'Oldingi sahifa',
  nextPage: 'Keyingi sahifa',
  emptyTitle: "Ma'lumot topilmadi",
  errorTitle: "Ma'lumotlarni yuklab bo'lmadi",
  retryLabel: 'Qayta urinish',
  loadingLabel: 'Yuklanmoqda…',
};

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: ReactNode;
  onRetry?: () => void;
  /** Rows per page (default 10). */
  pageSize?: number;
  /** Render a trailing actions cell (e.g. destructive confirm buttons). */
  renderRowActions?: (row: T) => ReactNode;
  /** Header for the actions column. */
  actionsHeader?: ReactNode;
  /** Extra controls rendered in the toolbar (e.g. a role <Select>). */
  toolbar?: ReactNode;
  /** Hide the built-in filter input (e.g. when filtering is server-side). */
  hideFilter?: boolean;
  emptyIcon?: ReactNode;
  /** Partial override of the localized labels. */
  labels?: Partial<DataTableLabels>;
}

// ─────────────────────────────────────────────────────────────────
// Pure helpers — exported for unit testing.
// ─────────────────────────────────────────────────────────────────

/** Locale-aware, nil-tolerant comparison (numbers numeric, strings collated). */
export function compareValues(a: CellValue, b: CellValue): number {
  const aNil = a === null || a === undefined || a === '';
  const bNil = b === null || b === undefined || b === '';
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Filter rows by a free-text query over each row's concatenated search text. */
export function filterRows<T>(
  rows: T[],
  getSearchText: (row: T) => string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => getSearchText(row).toLowerCase().includes(q));
}

/** Return a new array sorted by `getValue` in the given direction (stable). */
export function sortRows<T>(
  rows: T[],
  getValue: (row: T) => CellValue,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const cmp = compareValues(getValue(a), getValue(b));
    return dir === 'asc' ? cmp : -cmp;
  });
}

export interface PaginateResult<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** Slice `rows` into a single page, clamping `page` into the valid range. */
export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): PaginateResult<T> {
  const total = rows.length;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  return {
    items: rows.slice(start, start + size),
    page: safePage,
    totalPages,
    total,
  };
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

export function DataTable<T>({
  data,
  columns,
  getRowId,
  isLoading = false,
  isError = false,
  errorMessage,
  onRetry,
  pageSize = 10,
  renderRowActions,
  actionsHeader,
  toolbar,
  hideFilter = false,
  emptyIcon,
  labels: labelOverrides,
}: DataTableProps<T>) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };

  const [query, setQuery] = useState('');
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const filterableColumns = useMemo(
    () =>
      columns.filter(
        (c) => c.accessor && (c.filterable ?? true),
      ),
    [columns],
  );

  const getSearchText = useMemo(() => {
    return (row: T) =>
      filterableColumns
        .map((c) => {
          const v = c.accessor ? c.accessor(row) : undefined;
          return v === null || v === undefined ? '' : String(v);
        })
        .join(' ');
  }, [filterableColumns]);

  const sortColumn = columns.find((c) => c.id === sortColumnId) ?? null;

  // Derive the visible page: filter → sort → paginate.
  const { items, totalPages, total, currentPage } = useMemo(() => {
    const filtered = hideFilter
      ? data
      : filterRows(data, getSearchText, query);
    const sorted =
      sortColumn && sortColumn.accessor
        ? sortRows(filtered, sortColumn.accessor, sortDir)
        : filtered;
    const result = paginate(sorted, page, pageSize);
    return {
      items: result.items,
      totalPages: result.totalPages,
      total: result.total,
      currentPage: result.page,
    };
  }, [
    data,
    getSearchText,
    query,
    sortColumn,
    sortDir,
    page,
    pageSize,
    hideFilter,
  ]);

  function handleSort(column: DataTableColumn<T>) {
    if (!column.sortable || !column.accessor) return;
    if (sortColumnId === column.id) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumnId(column.id);
      setSortDir('asc');
    }
    setPage(1);
  }

  function sortedDirectionFor(column: DataTableColumn<T>): SortDirection {
    if (sortColumnId !== column.id) return false;
    return sortDir;
  }

  const totalColumns = columns.length + (renderRowActions ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {(!hideFilter || toolbar) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {!hideFilter ? (
            <div className="w-full sm:max-w-xs">
              <label className="sr-only" htmlFor="data-table-filter">
                {labels.filterLabel}
              </label>
              <Input
                id="data-table-filter"
                type="search"
                inputSize="sm"
                placeholder={labels.filterPlaceholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex items-center gap-3">{toolbar}</div> : null}
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <LoadingState variant="table" count={pageSize} label={labels.loadingLabel} />
      ) : isError ? (
        <ErrorState
          title={labels.errorTitle}
          message={errorMessage}
          retryLabel={labels.retryLabel}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={emptyIcon ?? <Inbox className="h-8 w-8" aria-hidden="true" />}
          title={labels.emptyTitle}
          {...(labels.emptyDescription
            ? { description: labels.emptyDescription }
            : {})}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) =>
                  column.sortable && column.accessor ? (
                    <SortableHead
                      key={column.id}
                      sorted={sortedDirectionFor(column)}
                      onSort={() => handleSort(column)}
                      className={column.align ? ALIGN_CLASS[column.align] : undefined}
                    >
                      {column.header}
                    </SortableHead>
                  ) : (
                    <TableHead
                      key={column.id}
                      className={column.align ? ALIGN_CLASS[column.align] : undefined}
                    >
                      {column.header}
                    </TableHead>
                  ),
                )}
                {renderRowActions ? (
                  <TableHead className="text-right">
                    {actionsHeader ?? <span className="sr-only">Amallar</span>}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={getRowId(row)}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.align ? ALIGN_CLASS[column.align] : undefined,
                        column.className,
                      )}
                    >
                      {renderCell(column, row)}
                    </TableCell>
                  ))}
                  {renderRowActions ? (
                    <TableCell className="text-right">
                      {renderRowActions(row)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Footer: result count + pagination */}
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs font-medium text-ink-soft">
              {labels.resultCount(items.length, total)}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {labels.pageStatus(currentPage, totalPages)}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={labels.previousPage}
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-rim text-ink-soft outline-none transition-colors hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={labels.nextPage}
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-rim text-ink-soft outline-none transition-colors hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function renderCell<T>(column: DataTableColumn<T>, row: T): ReactNode {
  if (column.cell) return column.cell(row);
  if (column.accessor) {
    const v = column.accessor(row);
    return v === null || v === undefined ? '—' : String(v);
  }
  return null;
}
