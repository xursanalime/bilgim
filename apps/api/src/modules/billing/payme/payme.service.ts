import { Injectable, Logger, Optional } from '@nestjs/common';
import { PaymeTxState, Prisma, PrismaClient } from '@prisma/client';

import { MetricsService } from '../../../infra/metrics/metrics.service';
import { OutboxService } from '../../../infra/outbox/outbox.service';
import {
  InvoiceRepository,
  INVOICE_KIND,
  INVOICE_STATUS,
} from '../repositories/invoice.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { canTransition } from '../subscription-state-machine';
import { paymeStateToNumber } from './payme.constants';
import {
  CancelTransactionParamsSchema,
  CheckPerformTransactionParamsSchema,
  CheckTransactionParamsSchema,
  CreateTransactionParamsSchema,
  GetStatementParamsSchema,
  PerformTransactionParamsSchema,
  PaymeMethodEnum,
} from './payme.dto';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';

/**
 * Result body returned to the controller. The controller wraps it in a
 * JSON-RPC envelope (`{ jsonrpc, id, result }`).
 */
export type PaymeResult = Record<string, unknown>;

/**
 * PaymeService — JSON-RPC method dispatcher for the Payme webhook.
 *
 * Task 4.3 scope: full atomic side effects on PerformTransaction
 *   - Invoice PENDING → PAID
 *   - STUDENT_COURSE → EnrollmentRequest(PENDING_APPROVAL)
 *   - TEACHER_SUBSCRIPTION → Subscription TRIAL/PAST_DUE → ACTIVE
 *   - OutboxEvent (`payment.succeeded` / `payment.failed`)
 * All in a single Prisma transaction with optimistic state locking
 * (Req 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8).
 *
 * Errors are surfaced as `PaymeError` instances; the global
 * `PaymeExceptionFilter` serializes them into `{ jsonrpc, id, error }` on
 * HTTP 200.
 */
@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly outboxService: OutboxService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Centralised metrics emit so every PaymeTransaction state change
   * passes through one place (Task 24.3, Req 26.2). The metric is
   * keyed by the canonical Prisma enum names so the labels survive
   * future renames cleanly.
   */
  private recordTransition(from: PaymeTxState, to: PaymeTxState): void {
    if (from === to) return;
    this.metrics?.recordPaymeTransition(from, to);
  }

  /**
   * Dispatch a Payme JSON-RPC call to the right handler. Unknown method →
   * `-32601`. Per-method param validation → `-32602` on Zod failure.
   */
  async dispatch(method: string, params: unknown): Promise<PaymeResult> {
    const parsedMethod = PaymeMethodEnum.safeParse(method);
    if (!parsedMethod.success) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSPORT_METHOD_NOT_FOUND, {
        method,
      });
    }

    switch (parsedMethod.data) {
      case 'CheckPerformTransaction':
        return this.checkPerformTransaction(
          this.parseParams(CheckPerformTransactionParamsSchema, params),
        );
      case 'CreateTransaction':
        return this.createTransaction(
          this.parseParams(CreateTransactionParamsSchema, params),
        );
      case 'PerformTransaction':
        return this.performTransaction(
          this.parseParams(PerformTransactionParamsSchema, params),
        );
      case 'CancelTransaction':
        return this.cancelTransaction(
          this.parseParams(CancelTransactionParamsSchema, params),
        );
      case 'CheckTransaction':
        return this.checkTransaction(
          this.parseParams(CheckTransactionParamsSchema, params),
        );
      case 'GetStatement':
        return this.getStatement(
          this.parseParams(GetStatementParamsSchema, params),
        );
      case 'ChangePassword':
        return { success: true };
    }
  }

  // ------------------------------------------------------------------
  // CheckPerformTransaction (Req 4.7)
  // ------------------------------------------------------------------

  private async checkPerformTransaction(params: {
    amount: number;
    account: { invoiceId: string };
  }): Promise<PaymeResult> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: params.account.invoiceId },
    });

    if (!invoice) {
      throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
    }

    if (
      invoice.status === INVOICE_STATUS.PAID ||
      invoice.status === INVOICE_STATUS.CANCELED ||
      invoice.status === INVOICE_STATUS.REFUNDED
    ) {
      throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
    }

    // Payme amount is in tiyin (1 so'm = 100 tiyin)
    const expectedTiyin = invoice.amountUzs * 100;
    if (params.amount !== expectedTiyin) {
      throw new PaymeError(PAYME_ERROR_CODES.INVALID_AMOUNT);
    }

    return { allow: true };
  }

  // ------------------------------------------------------------------
  // CreateTransaction (Req 4.1, 4.8)
  // ------------------------------------------------------------------

  private async createTransaction(params: {
    id: string;
    time: number;
    amount: number;
    account: { invoiceId: string };
  }): Promise<PaymeResult> {
    // Validate invoice + amount first (same checks as CheckPerformTransaction)
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: params.account.invoiceId },
    });
    if (!invoice) {
      throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
    }
    if (
      invoice.status === INVOICE_STATUS.PAID ||
      invoice.status === INVOICE_STATUS.CANCELED ||
      invoice.status === INVOICE_STATUS.REFUNDED
    ) {
      throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
    }
    if (params.amount !== invoice.amountUzs * 100) {
      throw new PaymeError(PAYME_ERROR_CODES.INVALID_AMOUNT);
    }

    // Idempotency: same paymeId returns same serialization
    const existing = await this.prisma.paymeTransaction.findUnique({
      where: { paymeId: params.id },
    });
    if (existing) {
      const existingAccount = existing.account as { invoiceId?: string } | null;
      if (existingAccount?.invoiceId !== params.account.invoiceId) {
        throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
      }
      if (
        existing.state !== PaymeTxState.CREATED &&
        existing.state !== PaymeTxState.PAID
      ) {
        throw new PaymeError(PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION);
      }
      return {
        create_time: Number(existing.createTime ?? 0),
        transaction: existing.id,
        state: paymeStateToNumber(existing.state),
      };
    }

    // Insert PaymeTransaction + link to Invoice in a single transaction
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const paymeTx = await tx.paymeTransaction.create({
          data: {
            paymeId: params.id,
            account: params.account as Prisma.InputJsonValue,
            amountUzs: invoice.amountUzs,
            state: PaymeTxState.CREATED,
            createTime: BigInt(params.time),
            rawPayload: { params } as Prisma.InputJsonValue,
            idempotencyKey: `payme:${params.id}`,
          },
        });
        // Link paymeTx to Invoice
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paymeTxId: paymeTx.id },
        });
        return paymeTx;
      });

      return {
        create_time: Number(created.createTime ?? 0),
        transaction: created.id,
        state: paymeStateToNumber(created.state),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.paymeTransaction.findUnique({
          where: { paymeId: params.id },
        });
        if (winner) {
          return {
            create_time: Number(winner.createTime ?? 0),
            transaction: winner.id,
            state: paymeStateToNumber(winner.state),
          };
        }
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // PerformTransaction — atomic side effects (Req 4.2, 4.4, 4.5, 4.6)
  // ------------------------------------------------------------------

  /**
   * The critical atomic path:
   *   1. PaymeTransaction CREATED → PAID
   *   2. Invoice PENDING → PAID
   *   3. invoice.kind === STUDENT_COURSE → EnrollmentRequest (PENDING_APPROVAL)
   *      invoice.kind === TEACHER_SUBSCRIPTION → Subscription → ACTIVE
   *   4. OutboxEvent('payment.succeeded')
   *
   * Idempotent: replays on PAID return the same serialization without
   * touching the DB. Concurrent calls race on the optimistic
   * `UPDATE WHERE state=CREATED` precondition; the loser re-reads and
   * returns the winner's result (Req 19.4).
   */
  private async performTransaction(params: {
    id: string;
  }): Promise<PaymeResult> {
    const tx = await this.prisma.paymeTransaction.findUnique({
      where: { paymeId: params.id },
    });
    if (!tx) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND);
    }

    // Already PAID — idempotent return (Req 4.4)
    if (tx.state === PaymeTxState.PAID) {
      return {
        perform_time: Number(tx.performTime ?? 0),
        transaction: tx.id,
        state: paymeStateToNumber(tx.state),
      };
    }
    if (tx.state !== PaymeTxState.CREATED) {
      throw new PaymeError(PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION);
    }

    // Find the linked Invoice
    const account = tx.account as { invoiceId?: string } | null;
    const invoiceId = account?.invoiceId;
    if (!invoiceId) {
      throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
    }

    const performTime = BigInt(Date.now());

    try {
      const result = await this.prisma.$transaction(async (txClient) => {
        // 1. Optimistically transition PaymeTransaction CREATED → PAID
        const txResult = await txClient.paymeTransaction.updateMany({
          where: { id: tx.id, state: PaymeTxState.CREATED },
          data: { state: PaymeTxState.PAID, performTime },
        });
        if (txResult.count === 0) {
          // Lost race — caller will re-read in catch
          throw new RaceLostError();
        }

        // 2. Mark Invoice PAID
        const invoice = await txClient.invoice.findUnique({
          where: { id: invoiceId },
        });
        if (!invoice) {
          throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND);
        }

        const invoiceUpdated = await this.invoiceRepository.markPaid(
          invoice.id,
          tx.id,
          txClient,
        );
        if (!invoiceUpdated) {
          this.logger.warn(
            `Invoice ${invoice.id} was not in PENDING when paying — likely concurrent flow`,
          );
        }

        // 3. Side effects per kind
        if (invoice.kind === INVOICE_KIND.STUDENT_COURSE) {
          if (!invoice.groupId || !invoice.studentId) {
            throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND, {
              reason: 'STUDENT_COURSE invoice missing groupId/studentId',
            });
          }
          // Create EnrollmentRequest (PENDING_APPROVAL)
          // Use upsert to handle the (groupId, studentId) UNIQUE constraint
          await txClient.enrollmentRequest.upsert({
            where: {
              groupId_studentId: {
                groupId: invoice.groupId,
                studentId: invoice.studentId,
              },
            },
            create: {
              groupId: invoice.groupId,
              studentId: invoice.studentId,
              status: 'PENDING_APPROVAL',
              invoiceId: invoice.id,
            },
            update: {
              // If a request already exists, link the invoice but don't
              // overwrite its status (it might already be APPROVED)
              invoiceId: invoice.id,
            },
          });
        } else if (invoice.kind === INVOICE_KIND.TEACHER_SUBSCRIPTION) {
          if (!invoice.subscriptionId) {
            throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND, {
              reason: 'TEACHER_SUBSCRIPTION invoice missing subscriptionId',
            });
          }
          const sub = await txClient.subscription.findUnique({
            where: { id: invoice.subscriptionId },
          });
          if (!sub) {
            throw new PaymeError(PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND, {
              reason: 'Subscription not found',
            });
          }
          // Allow TRIAL/PAST_DUE → ACTIVE. ACTIVE → ACTIVE is a no-op.
          if (sub.status !== 'ACTIVE' && canTransition(sub.status, 'ACTIVE')) {
            await this.subscriptionRepository.transitionStatus(
              sub.id,
              sub.status,
              'ACTIVE',
              txClient,
            );
          }
        }

        // 4. Emit outbox event (atomic with the above)
        await this.outboxService.create(txClient, {
          topic: 'payment.succeeded',
          payload: {
            paymeId: params.id,
            paymeTxId: tx.id,
            invoiceId: invoice.id,
            invoiceKind: invoice.kind,
            amountUzs: invoice.amountUzs,
            studentId: invoice.studentId ?? null,
            teacherId: invoice.teacherId ?? null,
            groupId: invoice.groupId ?? null,
            subscriptionId: invoice.subscriptionId ?? null,
          },
          idempotencyKey: `payment.succeeded:${params.id}`,
        });

        return {
          perform_time: Number(performTime),
          transaction: tx.id,
          state: paymeStateToNumber(PaymeTxState.PAID),
        };
      });

      this.logger.log(
        `PaymeTransaction ${tx.id} (paymeId=${params.id}) PAID, side effects committed`,
      );
      this.recordTransition(PaymeTxState.CREATED, PaymeTxState.PAID);
      return result;
    } catch (error) {
      if (error instanceof RaceLostError) {
        // Re-read — if winner ended in PAID, return that
        const refreshed = await this.prisma.paymeTransaction.findUnique({
          where: { id: tx.id },
        });
        if (refreshed?.state === PaymeTxState.PAID) {
          return {
            perform_time: Number(refreshed.performTime ?? 0),
            transaction: refreshed.id,
            state: paymeStateToNumber(refreshed.state),
          };
        }
        throw new PaymeError(PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION);
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // CancelTransaction (Req 4.7)
  // ------------------------------------------------------------------

  private async cancelTransaction(params: {
    id: string;
    reason: number;
  }): Promise<PaymeResult> {
    const tx = await this.prisma.paymeTransaction.findUnique({
      where: { paymeId: params.id },
    });
    if (!tx) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND);
    }

    if (
      tx.state === PaymeTxState.CANCELED ||
      tx.state === PaymeTxState.CANCELED_AFTER_PAY
    ) {
      return {
        cancel_time: Number(tx.cancelTime ?? 0),
        transaction: tx.id,
        state: paymeStateToNumber(tx.state),
      };
    }

    let nextState: PaymeTxState;
    if (tx.state === PaymeTxState.CREATED) {
      nextState = PaymeTxState.CANCELED;
    } else if (tx.state === PaymeTxState.PAID) {
      nextState = PaymeTxState.CANCELED_AFTER_PAY;
    } else {
      throw new PaymeError(PAYME_ERROR_CODES.CANNOT_CANCEL_TRANSACTION);
    }

    const cancelTime = BigInt(Date.now());
    const account = tx.account as { invoiceId?: string } | null;

    try {
      await this.prisma.$transaction(async (txClient) => {
        const result = await txClient.paymeTransaction.updateMany({
          where: { id: tx.id, state: tx.state },
          data: { state: nextState, cancelTime, reason: params.reason },
        });
        if (result.count === 0) {
          throw new RaceLostError();
        }

        // For CREATED→CANCELED, mark Invoice CANCELED + emit payment.failed
        if (
          tx.state === PaymeTxState.CREATED &&
          nextState === PaymeTxState.CANCELED &&
          account?.invoiceId
        ) {
          await txClient.invoice.updateMany({
            where: { id: account.invoiceId, status: INVOICE_STATUS.PENDING },
            data: { status: INVOICE_STATUS.CANCELED },
          });
          await this.outboxService.create(txClient, {
            topic: 'payment.failed',
            payload: {
              paymeId: params.id,
              paymeTxId: tx.id,
              invoiceId: account.invoiceId,
              reason: params.reason,
            },
            idempotencyKey: `payment.failed:${params.id}`,
          });
        }
      });
    } catch (error) {
      if (error instanceof RaceLostError) {
        const refreshed = await this.prisma.paymeTransaction.findUnique({
          where: { id: tx.id },
        });
        if (
          refreshed?.state === PaymeTxState.CANCELED ||
          refreshed?.state === PaymeTxState.CANCELED_AFTER_PAY
        ) {
          return {
            cancel_time: Number(refreshed.cancelTime ?? 0),
            transaction: refreshed.id,
            state: paymeStateToNumber(refreshed.state),
          };
        }
        throw new PaymeError(PAYME_ERROR_CODES.CANNOT_CANCEL_TRANSACTION);
      }
      throw error;
    }

    this.recordTransition(tx.state, nextState);

    return {
      cancel_time: Number(cancelTime),
      transaction: tx.id,
      state: paymeStateToNumber(nextState),
    };
  }

  // ------------------------------------------------------------------
  // CheckTransaction
  // ------------------------------------------------------------------

  private async checkTransaction(params: { id: string }): Promise<PaymeResult> {
    const tx = await this.prisma.paymeTransaction.findUnique({
      where: { paymeId: params.id },
    });
    if (!tx) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND);
    }
    return {
      create_time: Number(tx.createTime ?? 0),
      perform_time: Number(tx.performTime ?? 0),
      cancel_time: Number(tx.cancelTime ?? 0),
      transaction: tx.id,
      state: paymeStateToNumber(tx.state),
      reason: tx.reason ?? null,
    };
  }

  // ------------------------------------------------------------------
  // GetStatement
  // ------------------------------------------------------------------

  private async getStatement(params: {
    from: number;
    to: number;
  }): Promise<PaymeResult> {
    if (params.from > params.to) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSPORT_INVALID_PARAMS, {
        reason: 'from > to',
      });
    }

    const rows = await this.prisma.paymeTransaction.findMany({
      where: {
        createTime: { gte: BigInt(params.from), lte: BigInt(params.to) },
      },
      orderBy: { createTime: 'asc' },
      take: 1000,
    });

    return {
      transactions: rows.map((tx) => ({
        id: tx.paymeId,
        time: Number(tx.createTime ?? 0),
        amount: tx.amountUzs * 100,
        account: tx.account,
        create_time: Number(tx.createTime ?? 0),
        perform_time: Number(tx.performTime ?? 0),
        cancel_time: Number(tx.cancelTime ?? 0),
        transaction: tx.id,
        state: paymeStateToNumber(tx.state),
        reason: tx.reason ?? null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private parseParams<T>(
    schema: {
      safeParse: (
        v: unknown,
      ) => { success: boolean; data?: T; error?: { issues: unknown } };
    },
    params: unknown,
  ): T {
    const result = schema.safeParse(params ?? {});
    if (!result.success || result.data === undefined) {
      throw new PaymeError(PAYME_ERROR_CODES.TRANSPORT_INVALID_PARAMS, {
        issues: result.error?.issues ?? null,
      });
    }
    return result.data;
  }
}

/**
 * Internal sentinel — thrown when the optimistic lock loses the race.
 * Caller catches, re-reads, and returns the winner's serialization.
 */
class RaceLostError extends Error {
  constructor() {
    super('Optimistic lock race lost');
  }
}
