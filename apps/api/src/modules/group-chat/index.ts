export { GroupChatModule } from './group-chat.module';
export { GroupChatService } from './group-chat.service';
export { GroupChatRepository } from './repositories/group-chat.repository';
export {
  GROUP_CHAT_ALLOWED_ROLES,
  GROUP_CHAT_DEFAULT_PAGE_SIZE,
  GROUP_CHAT_MAX_PAGE_SIZE,
  GROUP_CHAT_SCOPE,
  MAX_GROUP_MESSAGE_BODY_LENGTH,
} from './group-chat.constants';
export type {
  CursorPage,
  GroupChatActor,
  GroupChatMemberSummary,
  GroupChatMessage,
  GroupChatSummary,
  SendGroupMessageResult,
} from './group-chat.service';
