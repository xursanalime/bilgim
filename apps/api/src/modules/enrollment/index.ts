export { EnrollmentModule } from './enrollment.module';
export {
  EnrollmentService,
  DEFAULT_INVITE_TTL_HOURS,
  DEFAULT_INVITE_USES_LIMIT,
} from './enrollment.service';
export type { CreatedInvite, InviteResolution } from './enrollment.service';
export { EnrollmentRepository } from './repositories/enrollment.repository';
export { InviteLinkRepository } from './repositories/invite-link.repository';
export { CreateInviteSchema, type CreateInviteDto } from './dto';
export { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
export type { LessonWithGroup } from '../../common/guards/lesson-access.guard';
