import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated user from the request (set by JwtAuthGuard/Passport).
 *
 * Usage:
 *   @Get('me')
 *   getProfile(@CurrentUser() user: JwtPayload) { ... }
 *
 *   @Get('me')
 *   getUserId(@CurrentUser('sub') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
