import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from './tokens.service';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequireBotCheck } from '../security/bot-detection/require-bot-check.decorator';
import {
  AuthService,
  LoginResult,
  MfaChallengeRequiredResult,
  RegisterResult,
  VerifyEmailResult,
  RefreshResult,
  PasswordResetRequestResult,
  PasswordResetConfirmResult,
  ResendVerificationResult,
  AccountUnlockResult,
} from './auth.service';
import {
  RegisterDto,
  RegisterSchema,
  LoginDto,
  LoginSchema,
  VerifyEmailDto,
  VerifyEmailSchema,
  RefreshDto,
  RefreshSchema,
  PasswordResetRequestDto,
  PasswordResetRequestSchema,
  PasswordResetConfirmDto,
  PasswordResetConfirmSchema,
  ResendVerificationDto,
  ResendVerificationSchema,
  AccountUnlockDto,
  AccountUnlockSchema,
  ChangePasswordDto,
  ChangePasswordSchema,
} from './dto';
import {
  MfaChallengeDto,
  MfaChallengeSchema,
} from '../mfa/dto/mfa-challenge.dto';

/**
 * AuthController — REST endpoints for authentication.
 * All auth endpoints are marked @Public() since they don't require JWT.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/register
   * Register a new user with email, password, fullName, and role.
   * Returns userId and confirmation message.
   */
  @Public()
  @RateLimit(10, '1m')
  @RequireBotCheck()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
  ): Promise<RegisterResult> {
    return this.authService.register(dto);
  }

  /**
   * POST /auth/verify-email
   * Verify email using the token sent during registration.
   * Marks user as ACTIVE.
   */
  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) dto: VerifyEmailDto,
  ): Promise<VerifyEmailResult> {
    return this.authService.verifyEmail(dto);
  }

  /**
   * POST /auth/login
   * Authenticate with email + password.
   * Returns accessToken (JWT 15min) + refreshToken (opaque 30d) + user info.
   * Also sets accessToken as HttpOnly cookie for browser clients.
   *
   * If the user has at least one verified MFA factor (TOTP, WebAuthn,
   * or backup codes), the response is a `MfaChallengeRequiredResult`
   * with `requiresMfa: true` and a short-lived `mfaToken`. Tokens
   * are NOT issued until the client completes
   * `POST /auth/mfa/challenge` with the second factor.
   */
  @Public()
  @RateLimit(20, '1m')
  @RequireBotCheck()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<LoginResult | MfaChallengeRequiredResult> {
    const result = await this.authService.login(dto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      headers: req.headers,
    });

    // MFA pivot — DO NOT set auth cookies; tokens are issued only
    // after the client completes the challenge.
    if ('requiresMfa' in result) {
      return result;
    }
    const tokens = result;

    // Set access token as HttpOnly cookie for browser clients (Req 21.3)
    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    // Set refresh token as HttpOnly cookie (Task 24.1):
    //   - sameSite=strict: refresh token never travels with cross-site nav
    //   - path=/api/v1/auth: scoped to auth endpoints behind the global prefix
    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/v1/auth',
    });

    return tokens;
  }

  /**
   * POST /auth/mfa/challenge
   * Complete an MFA challenge issued by `/auth/login`. Accepts either
   * a TOTP / backup code (`code`) or a WebAuthn assertion
   * (`webauthn.response`). On success the same access + refresh
   * cookies are set as a normal login.
   */
  @Public()
  @RateLimit(10, '1m')
  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  async mfaChallenge(
    @Body(new ZodValidationPipe(MfaChallengeSchema)) dto: MfaChallengeDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<LoginResult> {
    const input: {
      mfaToken: string;
      code?: string;
      webauthn?: { response: any };
    } = { mfaToken: dto.mfaToken };
    if (dto.code !== undefined) input.code = dto.code;
    if (dto.webauthn !== undefined) input.webauthn = dto.webauthn;

    const result = await this.authService.mfaChallenge(input, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });

    return result;
  }

  /**
   * POST /auth/refresh
   * Rotate refresh token: revoke old, issue new pair.
   * Implements token family detection (Req 1.6):
   * if a revoked token is reused, ALL sessions for that user are revoked.
   * Cookie settings: HttpOnly, Secure, SameSite=Lax (Req 21.3).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<RefreshResult> {
    // Accept refreshToken from body or cookie
    const refreshToken = dto.refreshToken || req.cookies?.refresh_token;
    const effectiveDto: RefreshDto = { refreshToken };

    const result = await this.authService.refresh(effectiveDto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    // Set new access token as HttpOnly cookie (Req 21.3)
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });

    // Set new refresh token as HttpOnly cookie (Task 24.1):
    //   - sameSite=strict: refresh token never travels with cross-site nav
    //   - path=/api/v1/auth: scoped to auth endpoints behind the global prefix
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/v1/auth',
    });

    return result;
  }

  /**
   * POST /auth/password-reset/request
   * Initiate password reset. Always returns 200 to prevent email enumeration.
   * Emits outbox event for email delivery.
   */
  @Public()
  @RateLimit(3, '1m')
  @RequireBotCheck()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  async passwordResetRequest(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) dto: PasswordResetRequestDto,
  ): Promise<PasswordResetRequestResult> {
    return this.authService.passwordResetRequest(dto);
  }

  /**
   * POST /auth/password-reset/confirm
   * Complete password reset with token and new password.
   * Revokes all sessions (force re-login).
   */
  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async passwordResetConfirm(
    @Body(new ZodValidationPipe(PasswordResetConfirmSchema)) dto: PasswordResetConfirmDto,
  ): Promise<PasswordResetConfirmResult> {
    return this.authService.passwordResetConfirm(dto);
  }

  /**
   * POST /auth/resend-verification
   * Re-send the email verification link for a pending account.
   *
   * Public so users that can't log in yet can still trigger it. The
   * service throttles to 1 request per email per hour and always
   * returns a generic 200 response (no email enumeration).
   *
   * The IP-bucket cap (3/min) is the second line of defence against
   * brute-force email enumeration via this route — Task 29.4.
   */
  @Public()
  @RateLimit(3, '1m')
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationSchema))
    dto: ResendVerificationDto,
  ): Promise<ResendVerificationResult> {
    return this.authService.resendVerification(dto);
  }

  /**
   * POST /auth/account/unlock
   * Consume a one-time unlock token mailed to the user when their
   * account hits the hard lockout tier (Task 27.2). Always returns
   * 200 with a generic message so the endpoint cannot be used to
   * confirm whether a token exists.
   *
   * Rate-limited per IP to deflect brute-force token guessing on top
   * of the hash-based lookup the service already performs.
   */
  @Public()
  @RateLimit(5, '1m')
  @Post('account/unlock')
  @HttpCode(HttpStatus.OK)
  async accountUnlock(
    @Body(new ZodValidationPipe(AccountUnlockSchema)) dto: AccountUnlockDto,
  ): Promise<AccountUnlockResult> {
    return this.authService.accountUnlock(dto);
  }

  /**
   * POST /auth/change-password
   * Change password for the authenticated user.
   * Requires the current password to be verified before updating.
   */
  @Post('change-password')
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
