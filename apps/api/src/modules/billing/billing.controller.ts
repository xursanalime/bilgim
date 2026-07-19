import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequireBotCheck } from '../security/bot-detection/require-bot-check.decorator';
import { JwtPayload } from '../auth/tokens.service';
import { BillingService } from './billing.service';
import { CheckoutDto, CheckoutSchema } from './dto/checkout.dto';

/**
 * BillingController — REST endpoints for checkout and subscription mgmt.
 *
 * Auth: STUDENT or TEACHER (the @Roles guard accepts both, the service
 * branches on the user's role + the dto.kind discriminator).
 */
@Controller('billing')
@Roles('STUDENT', 'TEACHER')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * GET /billing/invoices
   * Returns paginated invoice history for the authenticated user.
   */
  @Get('invoices')
  @HttpCode(HttpStatus.OK)
  async getMyInvoices(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billingService.getMyInvoices(user.sub, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }

  /**
   * POST /billing/checkout
   * Returns the Payme payUrl to redirect the user to.
   */
  @Post('checkout')
  @RequireBotCheck()
  @HttpCode(HttpStatus.OK)
  async checkout(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CheckoutSchema)) dto: CheckoutDto,
  ): Promise<{ invoiceId: string; payUrl: string; amountUzs: number }> {
    if (user.role !== 'STUDENT' && user.role !== 'TEACHER') {
      throw new UnauthorizedException({
        code: 'WRONG_ROLE',
        message: 'Only students or teachers can checkout',
      });
    }
    return this.billingService.checkout(
      user.sub,
      user.role as 'STUDENT' | 'TEACHER',
      dto,
    );
  }
}
