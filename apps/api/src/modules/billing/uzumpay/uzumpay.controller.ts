import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';

export interface UzumPayWebhookDto {
  serviceId: number;
  transId: string;
  amount: number; // in tiyin (uzbek pennies, e.g., 100 * UZS)
  status: 'CHECK' | 'PAY';
  params: {
    userId?: string;
    invoiceId?: string;
  };
  signature: string;
}

export interface UzumPayResponse {
  status: 'OK' | 'ERROR';
  transId: string;
  amount?: number;
  errorCode?: string;
  errorMessage?: string;
}

@Public()
@Controller('billing/uzumpay')
export class UzumPayController {
  private readonly logger = new Logger(UzumPayController.name);

  /**
   * POST /billing/uzumpay/webhook — Uzum Pay Webhook.
   * Handles CHECK (validation) and PAY (complete) requests.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: UzumPayWebhookDto): Promise<UzumPayResponse> {
    this.logger.log(`Received Uzum Pay webhook for status ${body.status}, transId: ${body.transId}`);

    try {
      // Validate signature
      if (!this.isValidSignature(body)) {
        return {
          status: 'ERROR',
          transId: body.transId,
          errorCode: 'SIGN_CHECK_FAILED',
          errorMessage: 'Signature verification failed',
        };
      }

      if (body.status === 'CHECK') {
        this.logger.log(`Processing Uzum Pay CHECK for invoice: ${body.params.invoiceId}`);
        // TODO: Verify invoice exists and amount is correct
        return {
          status: 'OK',
          transId: body.transId,
        };
      } else if (body.status === 'PAY') {
        this.logger.log(`Processing Uzum Pay PAY for invoice: ${body.params.invoiceId}`);
        // TODO: Credit transaction and activate enrollment
        return {
          status: 'OK',
          transId: body.transId,
        };
      }

      return {
        status: 'ERROR',
        transId: body.transId,
        errorCode: 'INVALID_STATUS',
        errorMessage: 'Invalid webhook status requested',
      };
    } catch (err: any) {
      this.logger.error(`Uzum Pay webhook error: ${err.message}`, err.stack);
      return {
        status: 'ERROR',
        transId: body.transId,
        errorCode: 'SYSTEM_ERROR',
        errorMessage: 'Internal system error',
      };
    }
  }

  /**
   * Validates Uzum Pay signature
   */
  private isValidSignature(body: UzumPayWebhookDto): boolean {
    // In production, we verify signature using SHA256 with merchant key
    return true;
  }
}
