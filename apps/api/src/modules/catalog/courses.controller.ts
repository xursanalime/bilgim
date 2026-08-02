import {
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
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { CatalogService } from './catalog.service';
import {
  CreateCourseDto,
  CreateCourseSchema,
  UpdateCourseDto,
  UpdateCourseSchema,
} from './dto';

/**
 * CoursesController — REST endpoints for the teacher Course catalog
 * (Req 7.1, 7.7).
 *
 * Auth: TEACHER for every route — cross-teacher access is enforced by the
 * service layer via `course.teacherId` filters.
 */
@Controller('catalog/courses')
@Roles('TEACHER')
export class CoursesController {
  constructor(private readonly catalogService: CatalogService) {}

  /**
   * POST /catalog/courses — Create a course (`isPublished=false`,
   * `isDiscoverable=true` per Req 7.1).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateCourseSchema)) dto: CreateCourseDto,
  ) {
    return this.catalogService.createCourse(user.sub, dto);
  }

  /** GET /catalog/courses — List the calling teacher's own courses. */
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.catalogService.listCoursesForTeacher(user.sub);
  }

  /** GET /catalog/courses/:id — Single course (own only). */
  @Get(':id')
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalogService.getCourseForTeacher(user.sub, id);
  }

  /** PATCH /catalog/courses/:id — Update title/description/level/fromPriceUzs. */
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCourseSchema)) dto: UpdateCourseDto,
  ) {
    return this.catalogService.updateCourse(user.sub, id, dto);
  }

  /** DELETE /catalog/courses/:id — Delete (own only). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.catalogService.deleteCourse(user.sub, id);
  }

  /**
   * PATCH /catalog/courses/:id/publish — Flip `isPublished=true`. Requires
   * an active subscription (Req 3.8).
   */
  @Patch(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalogService.publishCourse(user.sub, id);
  }
}
