import { SetMetadata } from '@nestjs/common';

/**
 * Reflector key for `@RequireBotCheck()` (Task 27.4, Req 27.6).
 *
 * Routes decorated with this metadata trigger
 * `BotDetectionGuard.canActivate()` even when the guard is wired
 * globally — operators apply it to high-risk endpoints (login,
 * register, payment, password reset) so the bot detector runs there
 * without forcing every public endpoint to pay the cost.
 */
export const REQUIRE_BOT_CHECK_KEY = 'requireBotCheck';

/**
 * Per-route opt-in for the bot detection pipeline.
 *
 * Composable with the standard NestJS guard chain — the guard reads
 * this metadata via `Reflector.getAllAndOverride()` so applying the
 * decorator at the controller level cascades to every route while a
 * method-level decorator wins on its specific handler.
 *
 * Usage:
 *   @RequireBotCheck()
 *   @Post('login')
 *   async login(@Body() dto: LoginDto) { ... }
 *
 * The default behaviour when the decorator is absent is to pass the
 * request straight through — the decision is intentionally opt-in
 * per route.
 */
export const RequireBotCheck = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_BOT_CHECK_KEY, true);
