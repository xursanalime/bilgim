import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AI_GATEWAY, type AiGateway } from '../ai.types';

export interface CreateConversationDto {
  title?: string | undefined;
}

export interface RenameConversationDto {
  title: string;
}

export interface SendMessageDto {
  content: string;
  attachments?: Array<{
    name: string;
    type: string;
    size: number;
    url?: string;
    assetId?: string;
    extractedText?: string;
  }>;
  locale?: 'uz' | 'ru' | 'en';
}

@Injectable()
export class AiConversationsService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  async listConversations(userId: string) {
    const conversations = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, content: true, createdAt: true },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastMessage: c.messages[0] ?? null,
    }));
  }

  async createConversation(userId: string, dto: CreateConversationDto) {
    return this.prisma.aiConversation.create({
      data: {
        userId,
        title: dto.title ?? 'Yangi suhbat',
      },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async getConversation(userId: string, id: string) {
    const conv = await this.prisma.aiConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            attachments: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Suhbat topilmadi' });
    if (conv.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Ruxsat yo\'q' });

    return conv;
  }

  async renameConversation(userId: string, id: string, dto: RenameConversationDto) {
    const conv = await this.prisma.aiConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Suhbat topilmadi' });
    if (conv.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Ruxsat yo\'q' });

    return this.prisma.aiConversation.update({
      where: { id },
      data: { title: dto.title.trim() || 'Yangi suhbat' },
      select: { id: true, title: true, updatedAt: true },
    });
  }

  async deleteConversation(userId: string, id: string) {
    const conv = await this.prisma.aiConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Suhbat topilmadi' });
    if (conv.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Ruxsat yo\'q' });

    await this.prisma.aiConversation.delete({ where: { id } });
    return { deleted: true };
  }

  async sendMessage(
    userId: string,
    userRole: 'STUDENT' | 'TEACHER' | 'ADMIN',
    conversationId: string,
    dto: SendMessageDto,
  ) {
    // Ensure conversation belongs to user
    const conv = await this.getConversation(userId, conversationId);

    // Build context from attachments' extracted text
    const attachmentContext = (dto.attachments ?? [])
      .filter((a) => a.extractedText)
      .map((a) => `[Fayl: ${a.name}]\n${a.extractedText}`)
      .join('\n\n');

    const fullContent = attachmentContext
      ? `${dto.content}\n\n---\nYuklangan fayllar:\n${attachmentContext}`
      : dto.content;

    // Save user message
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.content,
        attachments: dto.attachments
          ? (dto.attachments as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    // Build history for AI (last 20 messages)
    const history = conv.messages.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Determine locale
    const locale = dto.locale ?? 'uz';

    // Call AI
    const aiResult = await this.gateway.chat({
      userId,
      role: userRole,
      message: fullContent,
      history,
      locale,
    });

    // Save assistant reply
    const assistantMsg = await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: aiResult.reply,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // Auto-generate title after first exchange (1 user msg before this)
    if (conv.messages.length === 0 && conv.title === 'Yangi suhbat') {
      const autoTitle = dto.content.slice(0, 60).trim() + (dto.content.length > 60 ? '...' : '');
      await this.prisma.aiConversation.update({
        where: { id: conversationId },
        data: { title: autoTitle, updatedAt: new Date() },
      });
    } else {
      await this.prisma.aiConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    }

    return {
      message: assistantMsg,
      conversationId,
    };
  }

  async clearConversation(userId: string, conversationId: string) {
    const conv = await this.prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Suhbat topilmadi' });
    if (conv.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Ruxsat yo\'q' });

    await this.prisma.aiMessage.deleteMany({ where: { conversationId } });
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { title: 'Yangi suhbat', updatedAt: new Date() },
    });
    return { cleared: true };
  }
}
