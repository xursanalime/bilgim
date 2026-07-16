import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { UsersRepository } from '../auth/repositories/users.repository';
import {
  CompleteOnboardingResult,
  OnboardingLocale,
  OnboardingQuestionDto,
  OnboardingService,
  SubmitAnswersResult,
} from './onboarding.service';
import {
  CompleteOnboardingDto,
  CompleteOnboardingSchema,
  SubmitAnswersDto,
  SubmitAnswersSchema,
} from './dto';

const SUPPORTED_LOCALES = new Set<OnboardingLocale>(['uz', 'ru', 'en']);

/**
 * TeacherController — REST endpoints for the teacher onboarding flow.
 *
 * Auth: every route requires a TEACHER role JWT. The global `JwtAuthGuard` +
 * `RolesGuard` (registered in AppModule) enforce this; we mark the controller
 * with `@Roles('TEACHER')` so the metadata is class-wide.
 */
@Controller('teacher')
@Roles('TEACHER')
export class TeacherController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly usersRepository: UsersRepository,
  ) {}

  /**
   * GET /teacher/profile/me
   *
   * Returns the calling teacher's profile. Bilgim is English-only, so
   * instead of gating the dashboard behind a subject quiz we lazily ensure
   * the teacher is assigned the single English specialty on first access.
   * This makes the response always carry a `specialtyId`, so the dashboard
   * never redirects to onboarding.
   */
  @Get('profile/me')
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@CurrentUser() user: JwtPayload) {
    const userRecord = await this.usersRepository.findById(user.sub);
    const profile = await this.usersRepository.getProfile(user.sub);
    if (!profile) {
      // This case should ideally not happen for a user with a TEACHER role
      // but is handled for type safety.
      return this.onboardingService.ensureDefaultSpecialty(
        user.sub,
        userRecord?.fullName ?? null,
      );
    }
    return profile;
  }

  /**
   * POST /teacher/onboarding/complete
   *
   * LIVE instructor onboarding for the English-only platform (Req 10.2–10.4).
   * No specialty step: collects English-teaching attributes (taught CEFR levels
   * and exam-track focus), persists them on the TeacherProfile, and returns the
   * single English instructor dashboard URL to redirect to. The 14-day trial is
   * created separately at email verification (Req 10.1) and is unaffected here.
   */
  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CompleteOnboardingSchema))
    dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResult> {
    const userRecord = await this.usersRepository.findById(user.sub);
    return this.onboardingService.completeOnboarding(
      user.sub,
      userRecord?.fullName ?? null,
      dto,
    );
  }

  /**
   * GET /teacher/onboarding/questions
   *
   * @deprecated english-only-platform-refocus (Req 2.1) — the specialty quiz is
   * retired in favour of POST /teacher/onboarding/complete. Retained for
   * backward compatibility with legacy clients.
   *
   * Returns the active onboarding quiz, ordered by `OnboardingQuestion.order`,
   * with `text` localized to the request locale (Accept-Language → uz | ru | en).
   */
  @Get('onboarding/questions')
  @HttpCode(HttpStatus.OK)
  async getQuestions(
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<OnboardingQuestionDto[]> {
    const locale = await this.resolveLocale(acceptLanguage, user.sub);
    return this.onboardingService.listQuestions(locale);
  }

  /**
   * POST /teacher/onboarding/answers
   *
   * @deprecated english-only-platform-refocus (Req 2.1) — the specialty
   * classification flow is retired in favour of
   * POST /teacher/onboarding/complete. Retained for backward compatibility
   * with legacy clients; the legacy `specialtyId` body field is accepted and
   * ignored (Req 2.3).
   */
  @Post('onboarding/answers')
  @HttpCode(HttpStatus.OK)
  async submitAnswers(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(SubmitAnswersSchema)) dto: SubmitAnswersDto,
  ): Promise<SubmitAnswersResult> {
    // Pull the teacher's full name from User so we can populate the public
    // `TeacherProfile.fullName` field on first creation. Treat a missing User
    // row as an unauthenticated state; the JwtAuthGuard normally prevents this.
    const userRecord = await this.usersRepository.findById(user.sub);
    return this.onboardingService.submitAnswers(
      user.sub,
      userRecord?.fullName ?? null,
      dto,
    );
  }

  /**
   * Resolve the locale used to render the onboarding quiz.
   *
   * Priority:
   *   1. Accept-Language header — first supported tag wins.
   *   2. User.locale (default 'uz').
   *
   * Always returns one of {'uz', 'ru', 'en'}; unknown tags fall back to 'uz'.
   */
  private async resolveLocale(
    acceptLanguage: string | undefined,
    userId: string,
  ): Promise<OnboardingLocale> {
    if (acceptLanguage) {
      const tags = acceptLanguage
        .split(',')
        .map((tag) => {
          const head = tag.split(';')[0] ?? '';
          return head.trim().toLowerCase().slice(0, 2);
        });
      for (const tag of tags) {
        if (SUPPORTED_LOCALES.has(tag as OnboardingLocale)) {
          return tag as OnboardingLocale;
        }
      }
    }

    const user = await this.usersRepository.findById(userId);
    const userLocale = (user?.locale ?? 'uz').toLowerCase();
    if (SUPPORTED_LOCALES.has(userLocale as OnboardingLocale)) {
      return userLocale as OnboardingLocale;
    }
    return 'uz';
  }
}
