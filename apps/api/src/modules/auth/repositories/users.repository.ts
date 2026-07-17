import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaClient, Prisma, User, UserRole, UserStatus } from '@prisma/client';

export interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  status?: UserStatus;
}

/** Number of times we retry public-id generation on a unique collision. */
const PUBLIC_ID_MAX_ATTEMPTS = 5;

/** Generate a random 6-digit numeric public id in the range 100000–999999. */
function generatePublicId(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * UsersRepository — Prisma-based CRUD for the User table.
 * Only the auth module should write to User; other modules use read-only access.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /**
   * Search users for the DM "new conversation" picker. Matches the query
   * (case-insensitive) against `username`, `fullName`, or the 6-digit
   * `publicId`. Previously this only matched a `username` prefix, so the many
   * accounts registered without a username (fullName only) were never found.
   * Excludes soft-deleted users; returns ACTIVE accounts only.
   */
  async findManyByUsernamePrefix(query: string): Promise<User[]> {
    const q = query.trim();
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } },
          { publicId: { startsWith: q } },
        ],
      },
      orderBy: { fullName: 'asc' },
      take: 20,
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(
    input: CreateUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;

    // Generate a unique 6-digit public id, retrying on the rare collision
    // against the `publicId @unique` constraint (P2002).
    let lastError: unknown;
    for (let attempt = 0; attempt < PUBLIC_ID_MAX_ATTEMPTS; attempt++) {
      try {
        return await client.user.create({
          data: {
            publicId: generatePublicId(),
            email: input.email,
            username: input.username,
            passwordHash: input.passwordHash,
            fullName: input.fullName,
            role: input.role,
            status: input.status ?? 'PENDING_VERIFY',
          },
        });
      } catch (err) {
        // Only retry when the collision is specifically on `publicId`.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('publicId')
        ) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async updateStatus(
    userId: string,
    status: UserStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async updateUsername(
    userId: string,
    username: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data: { username },
    });
  }

  async getProfile(userId: string): Promise<any> {
    // `passwordHash` is deliberately excluded via `select` (never `include`)
    // — this method's result is returned as-is by GET /users/me and
    // GET /teacher/profile/me, and previously leaked the argon2 hash to any
    // authenticated client.
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        publicId: true,
        email: true,
        username: true,
        phone: true,
        telegramChatId: true,
        role: true,
        status: true,
        fullName: true,
        avatarUrl: true,
        locale: true,
        location: true,
        mfaRequired: true,
        createdAt: true,
        updatedAt: true,
        teacherProfile: true,
        studentProfile: true,
      },
    });
  }

  async updateProfile(userId: string, data: any, role: string): Promise<User> {
    const { fullName, phone, location, bio } = data;
    
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          fullName,
          phone: phone || null,
          location: location || null,
        },
      });

      if (role === 'TEACHER') {
        await tx.teacherProfile.upsert({
          where: { userId },
          update: { bio: bio || null },
          create: { userId, bio: bio || null },
        });
      } else if (role === 'STUDENT') {
        await tx.studentProfile.upsert({
          where: { userId },
          update: { bio: bio || null },
          create: { userId, bio: bio || null },
        });
      }

      return user;
    });
  }
}
