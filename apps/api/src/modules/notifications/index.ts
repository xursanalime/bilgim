export { NotificationsModule } from './notifications.module';
export { NotificationsService } from './notifications.service';
export { NotificationRepository } from './repositories/notification.repository';
export { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
export { PushDeviceRepository } from './repositories/push-device.repository';
export { NotificationFanoutProcessor } from './workers/notification-fanout.processor';
export { EmailProcessor } from './workers/email.processor';
export { TelegramProcessor } from './workers/telegram.processor';
export { PushProcessor } from './workers/push.processor';
export type { NotificationFanoutJob } from './workers/notification-fanout.processor';
export type { EmailJob } from './workers/email.processor';
export type { TelegramJob } from './workers/telegram.processor';
export type { PushJob } from './workers/push.processor';
export {
  UpdatePreferenceSchema,
  NotificationKindSchema,
  NotificationChannelSchema,
  ListNotificationsQuerySchema,
  RegisterDeviceSchema,
} from './dto';
export type {
  UpdatePreferenceDto,
  ListNotificationsQuery,
  RegisterDeviceDto,
} from './dto';
