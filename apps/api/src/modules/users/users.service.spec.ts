import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersRepository } from '../auth/repositories/users.repository';
import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let repository: UsersRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            findManyByUsernamePrefix: jest.fn(),
            findByUsername: jest.fn(),
            updateUsername: jest.fn(),
          },
        },
        {
          provide: PrismaClient,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<UsersRepository>(UsersRepository);
  });

  it('should search users by prefix', async () => {
    const mockUsers = [{ id: '1', username: 'testuser' }];
    jest.spyOn(repository, 'findManyByUsernamePrefix').mockResolvedValue(mockUsers as any);

    const result = await service.searchUsers('test');
    expect(result).toBe(mockUsers);
    expect(repository.findManyByUsernamePrefix).toHaveBeenCalledWith('test');
  });

  describe('updateUsername', () => {
    it('should update username when available', async () => {
      jest.spyOn(repository, 'findByUsername').mockResolvedValue(null);
      jest.spyOn(repository, 'updateUsername').mockResolvedValue({ id: '1', username: 'newname' } as any);

      const result = await service.updateUsername('1', 'newname');
      expect(result.username).toBe('newname');
      expect(repository.updateUsername).toHaveBeenCalledWith('1', 'newname');
    });

    it('should throw ConflictException when username is taken', async () => {
      jest.spyOn(repository, 'findByUsername').mockResolvedValue({ id: '2', username: 'taken' } as any);

      await expect(service.updateUsername('1', 'taken')).rejects.toThrow(ConflictException);
    });
  });
});
