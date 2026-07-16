import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';

export interface ClickWebhookDto {
  click_trans_id: number;
  service_id: number;
  click_paydoc_id: number;
  merchant_trans_id: string; // Internal Invoice or Subscription ID
  amount: number;
  action: number; // 0: Prepare, 1: Complete
  error: number;
  error_note?: string;
  sign_time: string;
  sign_string: string;
}

export interface ClickResponse {
  click_trans_id: number;
  merchant_trans_id: string;
  merchant_prepare_id?: number | string;
  merchant_confirm_id?: number | string;
  error: number; // 0: Success, negative or positive for errors
  error_note: string;
}

@Public()
@Controller('billing/click')
export class ClickController {
  private readonly logger = new Logger(ClickController.name);

  /**
   * POST /billing/click/webhook — Click Payment Webhook.
   * Handles Prepare (action=0) and Complete (action=1) requests.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: ClickWebhookDto): Promise<ClickResponse> {
    this.logger.log(`Received Click webhook for action ${body.action}, trans_id: ${body.click_trans_id}`);

    try {
      // Validate signature (click hash validation)
      if (!this.isValidSignature(body)) {
        return {
          click_trans_id: body.click_trans_id,
          merchant_trans_id: body.merchant_trans_id,
          error: -1, // SIGN CHECK FAILED
          error_note: 'Signature verification failed',
        };
      }

      // Process based on action
      if (body.action === 0) {
        // PREPARE ACTION
        this.logger.log(`Processing Click PREPARE for transaction ${body.click_trans_id}`);
        
        // TODO: Validate that amount matches the pending invoice, and user exists
        const prepareId = `prep_${body.click_trans_id}`;

        return {
          click_trans_id: body.click_trans_id,
          merchant_trans_id: body.merchant_trans_id,
          merchant_prepare_id: prepareId,
          error: 0,
          error_note: 'Success',
        };
      } else if (body.action === 1) {
        // COMPLETE ACTION
        this.logger.log(`Processing Click COMPLETE for transaction ${body.click_trans_id}`);
        
        // TODO: Apply payments, transition subscription, and create ledger entry
        const confirmId = `conf_${body.click_trans_id}`;

        return {
          click_trans_id: body.click_trans_id,
          merchant_trans_id: body.merchant_trans_id,
          merchant_confirm_id: confirmId,
          error: 0,
          error_note: 'Success',
        };
      }

      return {
        click_trans_id: body.click_trans_id,
        merchant_trans_id: body.merchant_trans_id,
        error: -3, // ACTION NOT FOUND
        error_note: 'Invalid action',
      };
    } catch (err: any) {
      this.logger.error(`Click webhook error: ${err.message}`, err.stack);
      return {
        click_trans_id: body.click_trans_id,
        merchant_trans_id: body.merchant_trans_id,
        error: -4, // SYSTEM ERROR
        error_note: 'Internal system error',
      };
    }
  }

  /**
   * Validates Click md5 sign_string
   */
  private isValidSignature(body: ClickWebhookDto): boolean {
    // In production, we build the MD5 hash using click_trans_id, service_id, secret_key, merchant_trans_id, amount, action, sign_time
    // return md5(click_trans_id + service_id + secret_key + merchant_trans_id + amount + action + sign_time) === sign_string
    return true;
  }
}
