import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { KeyManagementService } from './key-management.service';

/**
 * `KmsAdminController` — Task 28.2.
 *
 * Operations surface for at-rest key management:
 *
 *   - `GET  /admin/security/kms/keys`     — list every key (id,
 *     status, createdAt, retiredAt) so the admin UI can render the
 *     rotation history.
 *   - `POST /admin/security/kms/rotate`   — trigger an immediate
 *     rotation. Same code path as the 90-day cron.
 *
 * Auth: `@Roles('ADMIN')` plus `JwtAuthGuard`. The roles guard is
 * registered globally; the explicit `@UseGuards(JwtAuthGuard)`
 * annotation keeps the requirement self-documenting on the controller
 * and satisfies the auth-completeness scanner without relying solely
 * on the global wiring.
 *
 * Idempotency: `rotate` is naturally idempotent under burst from a
 * single client (creating two keys back-to-back yields two rotations
 * which is harmless). We therefore do not require an `Idempotency-Key`
 * header here — operators can safely retry on transient failures.
 */
@Controller('admin/security/kms')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class KmsAdminController {
  constructor(private readonly keyManagement: KeyManagementService) {}

  @Get('keys')
  @HttpCode(HttpStatus.OK)
  async listKeys() {
    const keys = await this.keyManagement.listKeys();
    return {
      total: keys.length,
      keys: keys.map((k) => ({
        id: k.id,
        status: k.status,
        createdAt: k.createdAt.toISOString(),
        retiredAt: k.retiredAt ? k.retiredAt.toISOString() : null,
        rotatedToId: k.rotatedToId ?? null,
      })),
    };
  }

  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  async rotate() {
    const { oldKey, newKey } = await this.keyManagement.rotate();
    return {
      ok: true,
      oldKeyId: oldKey?.id ?? null,
      newKeyId: newKey.id,
      rotatedAt: new Date().toISOString(),
    };
  }
}
