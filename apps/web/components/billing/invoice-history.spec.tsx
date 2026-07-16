import { render, screen } from '@testing-library/react';

import { InvoiceHistory } from './invoice-history';
import type { Invoice } from '../../lib/api/billing';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv_1',
    kind: 'TEACHER_SUBSCRIPTION',
    amountUzs: 150000,
    status: 'PAID',
    issuedAt: '2025-01-15T00:00:00.000Z',
    paidAt: '2025-01-15T00:00:00.000Z',
    paymeTxId: 'tx_1',
    groupId: null,
    subscriptionId: 'sub_1',
    studentId: null,
    teacherId: 'teacher_1',
    ...overrides,
  };
}

describe('InvoiceHistory', () => {
  it('renders the loading state', () => {
    render(<InvoiceHistory invoices={[]} locale="uz" isLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error state with retry', () => {
    render(
      <InvoiceHistory
        invoices={[]}
        locale="uz"
        isError
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /qayta urinish/i }),
    ).toBeInTheDocument();
  });

  it('renders the empty state when there are no invoices', () => {
    render(<InvoiceHistory invoices={[]} locale="uz" />);
    expect(screen.getByText(/topilmadi/i)).toBeInTheDocument();
  });

  it('renders a row with localized kind, status and amount', () => {
    render(<InvoiceHistory invoices={[makeInvoice()]} locale="uz" />);
    expect(screen.getByText(/Obuna to‘lovi/)).toBeInTheDocument();
    expect(screen.getByText(/To‘langan/)).toBeInTheDocument();
    expect(screen.getByText(/150.?000 so'm/)).toBeInTheDocument();
  });

  it('shows a receipt download link only when receiptUrl is present', () => {
    render(
      <InvoiceHistory
        invoices={[
          makeInvoice({ id: 'a', receiptUrl: 'https://pay.me/r/a' }),
          makeInvoice({ id: 'b' }),
        ]}
        locale="uz"
      />,
    );
    const links = screen.getAllByRole('link', { name: /yuklab olish/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://pay.me/r/a');
  });
});
