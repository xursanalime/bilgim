import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { UsersRepository } from '../auth/repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async searchUsers(username: string): Promise<User[]> {
    return this.usersRepository.findManyByUsernamePrefix(username);
  }

  async updateUsername(userId: string, username: string): Promise<User> {
    const existingUser = await this.usersRepository.findByUsername(username);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('Username is already taken');
    }
    try {
      return await this.usersRepository.updateUsername(userId, username);
    } catch (error) {
      // Concurrent request won the race between the check above and this
      // write — the unique constraint on `User.username` is the source of
      // truth, translate its P2002 into the same 409 the check would give.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username is already taken');
      }
      throw error;
    }
  }

  async getProfile(userId: string): Promise<any> {
    return this.usersRepository.getProfile(userId);
  }

  async updateProfile(userId: string, role: string, data: any): Promise<User> {
    return this.usersRepository.updateProfile(userId, data, role);
  }
}
