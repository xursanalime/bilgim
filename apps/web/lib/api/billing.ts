import { apiClient } from '../api-client';

export interface Invoice {
  id: string;
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  amountUzs: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  issuedAt: string;
  paidAt: string | null;
  paymeTxId: string | null;
  groupId: string | null;
  subscriptionId: string | null;
  studentId: string | null;
  teacherId: string | null;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
}

export const billingApi = {
  getMyInvoices: (params: { page?: number; limit?: number } = {}): Promise<InvoiceListResponse> =>
    apiClient.get('/billing/invoices', { params }),

  checkout: (data: { kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION'; groupId?: string; planSlug?: string }) =>
    apiClient.post<{ invoiceId: string; payUrl: string; amountUzs: number }>('/billing/checkout', data),
};
