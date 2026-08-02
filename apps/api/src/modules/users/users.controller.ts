import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Patch,
  Body,
  Put,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SearchUsersDto, SearchUsersSchema } from './dto/search-users.dto';
import {
  UpdateUsernameDto,
  UpdateUsernameSchema,
} from './dto/update-username.dto';
import {
  UpdateProfileDto,
  UpdateProfileSchema,
} from './dto/update-profile.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/tokens.service';
import { User } from '@prisma/client';

/**
 * Self-service profile routes. ADMIN is included because these are
 * "my own account" operations that every signed-in role needs — an admin
 * opening `/settings/profile` hits `GET /users/me`, which used to 403 for
 * them. (Contrast `DmController` / `GroupChatController`, where excluding
 * ADMIN is a deliberate product rule: platform-ops accounts do not
 * participate in chats.)
 */
@Controller('users')
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: JwtPayload) {
    const profileData = await this.usersService.getProfile(user.sub);
    
    if (!profileData) {
      throw new NotFoundException('User profile not found');
    }

    const bio =
      user.role === 'TEACHER'
        ? profileData.teacherProfile?.bio
        : profileData.studentProfile?.bio;

    return {
      id: profileData.id,
      email: profileData.email,
      username: profileData.username || '',
      fullName: profileData.fullName,
      phone: profileData.phone || '',
      location: profileData.location || '',
      bio: bio || '',
      avatarUrl: profileData.avatarUrl,
      role: profileData.role,
    };
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  async searchUsers(
    @Query(new ZodValidationPipe(SearchUsersSchema))
    query: SearchUsersDto,
  ): Promise<Pick<User, 'id' | 'username' | 'fullName' | 'avatarUrl' | 'role'>[]> {
    const users = await this.usersService.searchUsers(query.q);
    return users.map((u) => ({
      id: u.id,
      username: u.username || '',
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      role: u.role,
    }));
  }

  @Patch('me/username')
  @HttpCode(HttpStatus.OK)
  async updateUsername(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateUsernameSchema))
    dto: UpdateUsernameDto,
  ) {
    return this.usersService.updateUsername(user.sub, dto.username);
  }

  @Put('me/profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateProfileSchema))
    dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.sub, user.role, dto);
  }
}
