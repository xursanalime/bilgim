import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, User, UserRole, UserStatus } from '@prisma/client';

export interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  status?: UserStatus;
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

  async findManyByUsernamePrefix(username: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        username: {
          startsWith: username,
          mode: 'insensitive',
        },
        status: 'ACTIVE',
      },
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
    return client.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
        status: input.status ?? 'PENDING_VERIFY',
      },
    });
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
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
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
