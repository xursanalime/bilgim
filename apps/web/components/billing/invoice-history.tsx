'use client';

import { AlertTriangle, Download, Receipt } from 'lucide-react';

import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { LoadingState, ErrorState, EmptyState } from '../states';
import type { Invoice } from '../../lib/api/billing';
import {
  formatDate,
  formatUzs,
  invoiceKindLabel,
  invoiceStatusMeta,
} from './utils';

// ═════════════════════════════════════════════════════════════════
// InvoiceHistory — invoice list with payment status, UZS amount, date,
// and a receipt download link when the backend provides one (Req 13.3).
//
// Presentational: the parent owns data fetching and passes the resolved
// query state in. Covers the four data-backed view shapes (loading,
// error, empty, list) using the shared state primitives.
// ═════════════════════════════════════════════════════════════════

export interface InvoiceHistoryProps {
  invoices: Invoice[];
  locale: string;
  isLoading?: boolean;
  isError?: boolean;
  /** Retry handler surfaced in the error state. */
  onRetry?: () => void;
  className?: string;
}

export function InvoiceHistory({
  invoices,
  locale,
  isLoading = false,
  isError = false,
  onRetry,
  className,
}: InvoiceHistoryProps) {
  return (
    <section
      className={
        'overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-soft' +
        (className ? ` ${className}` : '')
      }
      aria-label="To‘lovlar tarixi"
    >
      <div className="border-b border-rim bg-tint/30 px-6 py-4">
        <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-ink-strong">
          <Receipt className="h-4.5 w-4.5 text-blue" aria-hidden="true" />
          To‘lovlar tarixi
        </h3>
      </div>

      <div className="p-4 sm:p-6">
        {isLoading ? (
          <LoadingState
            variant="table"
            count={4}
            label="To‘lovlar tarixi yuklanmoqda"
          />
        ) : isError ? (
          <ErrorState
            icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
            title="Ma'lumotlarni yuklab bo‘lmadi"
            message="To‘lovlar tarixini yuklashda xato yuz berdi. Qaytadan urinib ko‘ring."
            retryLabel="Qayta urinish"
            {...(onRetry ? { onRetry } : {})}
          />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-7 w-7" aria-hidden="true" />}
            title="Hech qanday to‘lov topilmadi"
            description="Kurs yoki obuna sotib olganingizdan so‘ng to‘lovlaringiz shu yerda ko‘rinadi."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tur</TableHead>
                <TableHead>Sana</TableHead>
                <TableHead className="text-right">Miqdor</TableHead>
                <TableHead>Holat</TableHead>
                <TableHead className="text-right">Chek</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const meta = invoiceStatusMeta(invoice.status);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-semibold text-ink-strong">
                      {invoiceKindLabel(invoice.kind)}
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {formatDate(invoice.issuedAt, locale)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-ink-strong">
                      {formatUzs(invoice.amountUzs, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.badgeVariant} size="sm">
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {invoice.receiptUrl ? (
                        <a
                          href={invoice.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-blue outline-none transition-colors hover:bg-blue-tint focus-visible:ring-2 focus-visible:ring-blue"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Yuklab olish
                        </a>
                      ) : (
                        <span className="text-xs text-ink-faint" aria-hidden="true">
                          —
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
