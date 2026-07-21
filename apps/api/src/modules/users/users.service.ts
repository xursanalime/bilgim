import { Injectable, ConflictException } from '@nestjs/common';
import { User } from '@prisma/client';
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
    return this.usersRepository.updateUsername(userId, username);
  }

  async getProfile(userId: string): Promise<any> {
    return this.usersRepository.getProfile(userId);
  }

  async updateProfile(userId: string, role: string, data: any): Promise<User> {
    return this.usersRepository.updateProfile(userId, data, role);
  }
}
