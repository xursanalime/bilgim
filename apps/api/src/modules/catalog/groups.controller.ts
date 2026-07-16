import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { HomeworkModuleType } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { CatalogService } from './catalog.service';
import {
  BulkUpsertGroupModulesDto,
  BulkUpsertGroupModulesSchema,
  CreateGroupDto,
  CreateGroupSchema,
  HomeworkModuleTypeSchema,
  ToggleGroupModuleBodyDto,
  ToggleGroupModuleBodySchema,
  UpdateGroupDto,
  UpdateGroupSchema,
  UpdateGroupSettingsDto,
  UpdateGroupSettingsSchema,
} from './dto';

/**
 * GroupsController — REST endpoints for the teacher Group catalog
 * (Req 7.2, 7.3, 7.7).
 *
 * Routes:
 *   POST   /catalog/courses/:courseId/groups
 *   GET    /catalog/courses/:courseId/groups
 *   GET    /catalog/groups/:id
 *   PATCH  /catalog/groups/:id
 *   DELETE /catalog/groups/:id
 *
 * The two route shapes share a single controller because NestJS only allows
 * one base path per controller and the "create + list inside a course" pair
 * naturally lives next to "single group" operations.
 */
@Controller('catalog')
export class GroupsController {
  constructor(private readonly catalogService: CatalogService) {}

  /**
   * POST /catalog/courses/:courseId/groups — Create a Group inside a course
   * the teacher owns. Atomically seeds GroupModule rows from the teacher's
   * specialty catalog (Req 7.2, 7.3).
   */
  @Roles('TEACHER')
  @Post('courses/:courseId/groups')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Body(new ZodValidationPipe(CreateGroupSchema)) dto: CreateGroupDto,
  ) {
    return this.catalogService.createGroup(user.sub, courseId, dto);
  }

  /** GET /catalog/courses/:courseId/groups — List groups for a course. */
  @Roles('TEACHER')
  @Get('courses/:courseId/groups')
  async listByCourse(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    return this.catalogService.listGroupsForCourse(user.sub, courseId);
  }

  /** GET /catalog/groups/:id — Single group (own or enrolled). */
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('groups/:id')
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalogService.getGroupForUser(user.sub, user.role, id);
  }

  /** PATCH /catalog/groups/:id — Update name/priceUzs/capacity/dates. */
  @Roles('TEACHER')
  @Patch('groups/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateGroupSchema)) dto: UpdateGroupDto,
  ) {
    return this.catalogService.updateGroup(user.sub, id, dto);
  }

  /** DELETE /catalog/groups/:id — Delete a group (own only). */
  @Roles('TEACHER')
  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.catalogService.deleteGroup(user.sub, id);
  }

  /**
   * PATCH /catalog/groups/:id/settings — Toggle the server-authoritative
   * `downloadAllowed` Download_Permission (Content Protection Req 4.5).
   *
   * Body: `{ downloadAllowed: boolean }` (Zod-validated). Only the owning
   * TEACHER or an ADMIN may flip the flag; the service enforces ownership
   * and reads the persisted value back so the client can never assert it
   * (Req 4.4). Returns the updated Group DTO with `downloadAllowed` surfaced.
   */
  @Roles('TEACHER', 'ADMIN')
  @Patch('groups/:id/settings')
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateGroupSettingsSchema))
    dto: UpdateGroupSettingsDto,
  ) {
    return this.catalogService.updateGroupSettings(
      user.sub,
      user.role,
      id,
      dto,
    );
  }

  // ==================================================================
  // Per-Group module toggle (Req 11.2 – 11.7)
  // ==================================================================

  /**
   * GET /catalog/groups/:groupId/modules — Return the per-Group toggle
   * catalog. Teacher sees their own group; ADMIN sees any group (read-only
   * audit access).
   */
  @Roles('TEACHER', 'ADMIN')
  @Get('groups/:groupId/modules')
  async listModules(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    return this.catalogService.listGroupModules(user.sub, user.role, groupId);
  }

  /**
   * PATCH /catalog/groups/:groupId/modules/:moduleType — Single-toggle
   * convenience endpoint (Req 11.3). Body: `{ isEnabled: boolean }`.
   *
   * The path's `moduleType` is validated against the `HomeworkModuleType`
   * enum at the controller boundary; the service additionally validates it
   * against the group's specialty catalog (`MODULE_NOT_IN_SPECIALTY_CATALOG`).
   */
  @Roles('TEACHER', 'ADMIN')
  @Patch('groups/:groupId/modules/:moduleType')
  async toggleModule(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('moduleType') moduleTypeRaw: string,
    @Body(new ZodValidationPipe(ToggleGroupModuleBodySchema))
    dto: ToggleGroupModuleBodyDto,
  ) {
    // Validate the enum literal at the controller boundary so the service
    // never sees garbage strings (Prisma would otherwise throw a generic
    // P2009-style error and leak the constraint shape).
    const parsed = HomeworkModuleTypeSchema.safeParse(moduleTypeRaw);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_MODULE_TYPE',
        message: `moduleType "${moduleTypeRaw}" is not a recognized HomeworkModuleType`,
      });
    }
    const moduleType = parsed.data as HomeworkModuleType;
    return this.catalogService.toggleGroupModule(
      user.sub,
      user.role,
      groupId,
      moduleType,
      dto.isEnabled,
    );
  }

  /**
   * POST /catalog/groups/:groupId/modules/:moduleType — Sibling of PATCH,
   * supplied to satisfy Task 17.2's `POST/PATCH` requirement. Idempotent:
   * the service treats both verbs identically because the toggle is a
   * single-row upsert keyed by `(groupId, moduleType)`.
   *
   * Idempotent re-posts that don't flip the row are no-ops (no audit /
   * outbox entry is appended).
   */
  @Roles('TEACHER', 'ADMIN')
  @Post('groups/:groupId/modules/:moduleType')
  @HttpCode(HttpStatus.OK)
  async toggleModulePost(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('moduleType') moduleTypeRaw: string,
    @Body(new ZodValidationPipe(ToggleGroupModuleBodySchema))
    dto: ToggleGroupModuleBodyDto,
  ) {
    return this.toggleModule(user, groupId, moduleTypeRaw, dto);
  }

  /**
   * PUT /catalog/groups/:groupId/modules — Bulk upsert (Req 11.3).
   *
   * Body: `{ modules: [{ moduleType, isEnabled }] }`. Same validations as
   * the single-toggle endpoint applied across the full batch in one
   * transaction; emits one `group.module.toggled` event per row that
   * actually flipped state.
   */
  @Roles('TEACHER', 'ADMIN')
  @Put('groups/:groupId/modules')
  @HttpCode(HttpStatus.OK)
  async bulkToggleModules(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodValidationPipe(BulkUpsertGroupModulesSchema))
    dto: BulkUpsertGroupModulesDto,
  ) {
    return this.catalogService.bulkToggleGroupModules(
      user.sub,
      user.role,
      groupId,
      dto,
    );
  }
}
