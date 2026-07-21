import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Specifies which roles are allowed to access a route.
 * Works with RolesGuard.
 *
 * Usage:
 *   @Roles('TEACHER', 'ADMIN')
 *   @Get('dashboard')
 *   getDashboard() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
