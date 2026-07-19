import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  GenerateBackupCodesDto,
  GenerateBackupCodesSchema,
  TotpDisableDto,
  TotpDisableSchema,
  TotpSetupDto,
  TotpSetupSchema,
  TotpVerifyDto,
  TotpVerifySchema,
  UseBackupCodeDto,
  UseBackupCodeSchema,
  WebAuthnAuthenticationFinishDto,
  WebAuthnAuthenticationFinishSchema,
  WebAuthnAuthenticationOptionsDto,
  WebAuthnAuthenticationOptionsSchema,
  WebAuthnRegistrationFinishDto,
  WebAuthnRegistrationFinishSchema,
  WebAuthnRegistrationOptionsDto,
  WebAuthnRegistrationOptionsSchema,
} from './dto';
import { MfaService } from './mfa.service';

/**
 * `MfaController` — REST surface for the MFA module (Task 29.1).
 *
 * All routes require authentication; the role gate is the broadest
 * acceptable set (any logged-in user can self-manage their factors).
 * Role-based enforcement of MFA at login lives in `AuthService`, not
 * here.
 */
@Controller('mfa')
@Roles('STUDENT', 'TEACHER', 'ADMIN')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  // ------------------------------------------------------------------
  // TOTP
  // ------------------------------------------------------------------

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  async setupTotp(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TotpSetupSchema)) dto: TotpSetupDto,
  ) {
    return this.mfaService.setupTotp(user.sub, dto.label);
  }

  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TotpVerifySchema)) dto: TotpVerifyDto,
  ) {
    return this.mfaService.verifyTotpEnrollment(user.sub, dto.code);
  }

  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  async disableTotp(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TotpDisableSchema)) dto: TotpDisableDto,
  ) {
    return this.mfaService.disableTotp(user.sub, dto.password, dto.code);
  }

  // ------------------------------------------------------------------
  // WebAuthn
  // ------------------------------------------------------------------

  @Post('webauthn/registration-options')
  @HttpCode(HttpStatus.OK)
  async webauthnRegistrationOptions(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(WebAuthnRegistrationOptionsSchema))
    _dto: WebAuthnRegistrationOptionsDto,
  ) {
    return this.mfaService.generateWebAuthnRegistrationOptions(user.sub);
  }

  @Post('webauthn/registration-finish')
  @HttpCode(HttpStatus.OK)
  async webauthnRegistrationFinish(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(WebAuthnRegistrationFinishSchema))
    dto: WebAuthnRegistrationFinishDto,
  ) {
    return this.mfaService.finishWebAuthnRegistration(
      user.sub,
      dto.response as any,
      dto.label,
    );
  }

  @Post('webauthn/authentication-options')
  @HttpCode(HttpStatus.OK)
  async webauthnAuthenticationOptions(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(WebAuthnAuthenticationOptionsSchema))
    _dto: WebAuthnAuthenticationOptionsDto,
  ) {
    return this.mfaService.generateWebAuthnAuthenticationOptions(user.sub);
  }

  @Post('webauthn/authentication-finish')
  @HttpCode(HttpStatus.OK)
  async webauthnAuthenticationFinish(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(WebAuthnAuthenticationFinishSchema))
    dto: WebAuthnAuthenticationFinishDto,
  ) {
    return this.mfaService.finishWebAuthnAuthentication(
      user.sub,
      dto.response as any,
    );
  }

  // ------------------------------------------------------------------
  // Backup codes
  // ------------------------------------------------------------------

  @Post('backup-codes/generate')
  @HttpCode(HttpStatus.OK)
  async generateBackupCodes(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(GenerateBackupCodesSchema))
    _dto: GenerateBackupCodesDto,
  ) {
    return this.mfaService.generateBackupCodes(user.sub);
  }

  @Post('backup-codes/use')
  @HttpCode(HttpStatus.OK)
  async useBackupCode(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UseBackupCodeSchema)) dto: UseBackupCodeDto,
  ) {
    return this.mfaService.consumeBackupCode(user.sub, dto.code);
  }

  // ------------------------------------------------------------------
  // Credential management
  // ------------------------------------------------------------------

  @Get('credentials')
  async listCredentials(@CurrentUser() user: JwtPayload) {
    return this.mfaService.listCredentials(user.sub);
  }

  @Delete('credentials/:id')
  async revokeCredential(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.mfaService.revokeCredential(user.sub, id);
  }
}
