import { Injectable } from '@nestjs/common';
import { Invoice, Prisma, PrismaClient } from '@prisma/client';

/**
 * Invoice statuses (string-typed in Prisma model — keep them centralized).
 */
export const INVOICE_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
} as const;

export const INVOICE_KIND = {
  STUDENT_COURSE: 'STUDENT_COURSE',
  TEACHER_SUBSCRIPTION: 'TEACHER_SUBSCRIPTION',
} as const;

export interface CreateInvoiceInput {
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  amountUzs: number;
  teacherId?: string | null;
  studentId?: string | null;
  groupId?: string | null;
  subscriptionId?: string | null;
}

@Injectable()
export class InvoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Invoice | null> {
    const client = tx ?? this.prisma;
    return client.invoice.findUnique({ where: { id } });
  }

  async create(
    input: CreateInvoiceInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Invoice> {
    const client = tx ?? this.prisma;
    return client.invoice.create({
      data: {
        kind: input.kind,
        amountUzs: input.amountUzs,
        status: INVOICE_STATUS.PENDING,
        teacherId: input.teacherId ?? null,
        studentId: input.studentId ?? null,
        groupId: input.groupId ?? null,
        subscriptionId: input.subscriptionId ?? null,
      },
    });
  }

  /**
   * Atomically transition Invoice from PENDING → PAID using updateMany
   * with a status precondition. Returns true if the row was actually
   * updated (winning side of the race), false otherwise.
   */
  async markPaid(
    invoiceId: string,
    paymeTxId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.invoice.updateMany({
      where: { id: invoiceId, status: INVOICE_STATUS.PENDING },
      data: {
        status: INVOICE_STATUS.PAID,
        paidAt: new Date(),
        paymeTxId,
      },
    });
    return result.count > 0;
  }

  async linkPaymeTx(
    invoiceId: string,
    paymeTxId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.invoice.update({
      where: { id: invoiceId },
      data: { paymeTxId },
    });
  }

  async findByUser(
    userId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ items: Invoice[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          OR: [{ studentId: userId }, { teacherId: userId }],
        },
        orderBy: { issuedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({
        where: {
          OR: [{ studentId: userId }, { teacherId: userId }],
        },
      }),
    ]);

    return { items, total };
  }
}
