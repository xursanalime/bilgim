import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CefrLevel, OnboardingQuestion, Prisma, PrismaClient, Specialty } from '@prisma/client';

import { SpecialtyService } from './specialty.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { CompleteOnboardingDto, SubmitAnswersDto } from './dto';

/**
 * Locale supported by OnboardingQuestion.text* columns.
 * Defaults to 'uz' (Requirement 2 user story is written in O'zbek).
 */
export type OnboardingLocale = 'uz' | 'ru' | 'en';

/**
 * Confidence threshold below which we trigger the AI fallback.
 * Set to 0.55 per task description and Requirement 2.4
 * ("agar quiz javoblari 55% dan past confidence bersa, Claude fallback").
 */
const AI_FALLBACK_THRESHOLD = 0.55;

/**
 * Shape of a single option inside OnboardingQuestion.optionsJson.
 *
 * `weights` maps a specialty slug (e.g. "english", "mathematics", "smm") to a
 * non-negative weight; the rule-based classifier sums these across all
 * answered questions and returns the slug with the highest total.
 */
interface QuestionOption {
  id: string;
  text: { uz: string; ru: string; en: string } | string;
  weights?: Record<string, number>;
}

/**
 * Shape returned to the client by GET /teacher/onboarding/questions.
 * `text` is already localized to the request locale, and `weights` are stripped
 * from the options to avoid leaking the classifier internals.
 */
export interface OnboardingQuestionDto {
  id: string;
  order: number;
  text: string;
  specialtyId: string | null;
  multiSelect: boolean;
  options: Array<{ id: string; text: string }>;
}

/**
 * Shape returned to the client by POST /teacher/onboarding/answers.
 */
export interface SubmitAnswersResult {
  specialty: {
    id: string;
    slug: string;
    nameUz: string;
    nameRu: string;
    nameEn: string;
  };
  dashboardUrl: string;
  confidence: number;
  usedAiFallback: boolean;
}

/**
 * Shape returned to the client by POST /teacher/onboarding/complete.
 *
 * The refocused, English-only onboarding result. There is no specialty —
 * every instructor teaches English — so completion always routes to the single
 * English instructor dashboard (Req 10.4).
 */
export interface CompleteOnboardingResult {
  dashboardUrl: string;
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
}

/**
 * The single English instructor dashboard URL the platform routes to once
 * onboarding completes (Req 10.4). No longer specialty-specific.
 */
export const ENGLISH_DASHBOARD_URL = '/dashboard';

/**
 * Internal: result of the rule-based classifier.
 */
interface ClassifyResult {
  specialtySlug: string;
  confidence: number;
  totals: Record<string, number>;
}

/**
 * OnboardingService — handles teacher onboarding:
 *  1. List quiz questions (locale-aware).
 *  2. Persist a teacher's answers, classify them into a Specialty, create or
 *     update the TeacherProfile, and return the redirect URL.
 *
 * The classifier is deterministic and rule-based (Requirement 2.2). When the
 * top score's confidence is below {@link AI_FALLBACK_THRESHOLD}, we log that
 * the AI fallback would run (Requirement 2.4) but still return the highest
 * scoring specialty so the teacher always lands on a dashboard
 * (Requirement 2.3, 2.5).
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly specialtyService: SpecialtyService,
    private readonly teacherProfileRepository: TeacherProfileRepository,
  ) {}

  /**
   * @deprecated english-only-platform-refocus (Req 2.1, 2.5) — the
   * specialty-classification quiz is retired. The live onboarding path is
   * {@link completeOnboarding}. Retained for backward compatibility with
   * legacy clients until the Specialty decommission completes.
   *
   * Return active onboarding questions in display order, with text localized to
   * the requested locale and weights stripped from the options.
   */
  async listQuestions(locale: OnboardingLocale): Promise<OnboardingQuestionDto[]> {
    const questions = await this.prisma.onboardingQuestion.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    return questions.map((q) => this.toQuestionDto(q, locale));
  }

  /**
   * Complete the refocused, English-only instructor onboarding (Req 10.2–10.4).
   *
   * There is NO specialty selection step. Every instructor teaches English, so
   * this:
   *   1. Idempotently ensures the TeacherProfile exists and is stamped with the
   *      seeded `english` specialty + onboarding completion via
   *      {@link ensureDefaultSpecialty} (keeps downstream `ONBOARDING_REQUIRED`
   *      guards passing).
   *   2. De-duplicates and validates the collected English-teaching attributes:
   *      `taughtCefrLevels` (already enum-checked by the DTO) and
   *      `examTrackFocus` slugs (checked against the active `ExamTrack` catalog).
   *   3. Persists those attributes on the TeacherProfile.
   *   4. Routes the instructor to the single English dashboard (Req 10.4).
   *
   * The 14-day trial is NOT created here — it is provisioned at email
   * verification by the billing module (Req 10.1) and is intentionally
   * decoupled from this flow.
   */
  async completeOnboarding(
    teacherUserId: string,
    teacherFullName: string | null,
    dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResult> {
    // 1. Keep the profile valid: stamp the English specialty + onboarding.
    await this.ensureDefaultSpecialty(teacherUserId, teacherFullName);

    // 2. De-duplicate while preserving declaration order.
    const taughtCefrLevels = this.dedupe<CefrLevel>(dto.taughtCefrLevels ?? []);
    const examTrackFocus = this.dedupe<string>(dto.examTrackFocus ?? []);

    // 3. Validate every exam-track slug exists and is active in the catalog.
    if (examTrackFocus.length > 0) {
      const tracks = await this.prisma.examTrack.findMany({
        where: { slug: { in: examTrackFocus }, isActive: true },
        select: { slug: true },
      });
      const known = new Set(tracks.map((t) => t.slug));
      const missing = examTrackFocus.filter((slug) => !known.has(slug));
      if (missing.length > 0) {
        throw new BadRequestException({
          code: 'EXAM_TRACK_NOT_FOUND',
          message: `Unknown or inactive exam tracks: ${missing.join(', ')}`,
        });
      }
    }

    // 4. Persist the English-teaching attributes.
    await this.teacherProfileRepository.updateEnglishTeachingAttributes(
      teacherUserId,
      { taughtCefrLevels, examTrackFocus },
    );

    this.logger.log(
      `Teacher ${teacherUserId} completed English onboarding ` +
        `(levels=[${taughtCefrLevels.join(',')}], tracks=[${examTrackFocus.join(',')}])`,
    );

    return {
      dashboardUrl: ENGLISH_DASHBOARD_URL,
      taughtCefrLevels,
      examTrackFocus,
    };
  }

  private dedupe<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }

  /**
   * @deprecated english-only-platform-refocus (Req 2.1, 2.5) — the
   * specialty-classification quiz is retired. The live onboarding path is
   * {@link completeOnboarding}, which collects English-teaching attributes and
   * routes to the single English dashboard. This method is retained only for
   * backward compatibility with legacy clients until the Specialty
   * decommission completes.
   *
   * Submit onboarding answers and assign a specialty to the teacher.
   *
   * Steps:
   *   1. Load the referenced questions, validate every questionId is real and
   *      every selectedOptionId exists on its question.
   *   2. Run the rule-based classifier (sum weights, normalize).
   *   3. If confidence < 55%, log AI fallback (stub) — we still default to the
   *      highest scoring specialty so the teacher gets a dashboard.
   *   4. In a single transaction:
   *        - upsert OnboardingAnswer rows (idempotent per (teacherId, questionId))
   *        - upsert TeacherProfile with the chosen specialtyId and
   *          onboardingCompletedAt = now
   *   5. Return the chosen specialty + dashboard URL to the controller.
   */
  async submitAnswers(
    teacherUserId: string,
    teacherFullName: string | null,
    dto: SubmitAnswersDto,
  ): Promise<SubmitAnswersResult> {
    // Load referenced questions and ensure they are all valid + active
    const questionIds = dto.answers.map((a) => a.questionId);
    const questions = await this.prisma.onboardingQuestion.findMany({
      where: { id: { in: questionIds }, isActive: true },
    });

    if (questions.length !== questionIds.length) {
      const foundIds = new Set(questions.map((q) => q.id));
      const missing = questionIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        code: 'ONBOARDING_QUESTION_NOT_FOUND',
        message: `Unknown or inactive onboarding questions: ${missing.join(', ')}`,
      });
    }

    // Build a lookup so we can validate selectedOptionId and feed the classifier
    const questionsById = new Map(questions.map((q) => [q.id, q]));
    for (const answer of dto.answers) {
      const question = questionsById.get(answer.questionId)!;
      const options = this.parseOptions(question.optionsJson);
      const known = options.find((o) => o.id === answer.selectedOptionId);
      if (!known) {
        throw new BadRequestException({
          code: 'INVALID_OPTION',
          message: `Option ${answer.selectedOptionId} is not valid for question ${answer.questionId}`,
        });
      }
    }

    // Classify (deterministic rule-based)
    const classification = this.classify(dto, questionsById);

    let usedAiFallback = false;
    if (classification.confidence < AI_FALLBACK_THRESHOLD) {
      // The generic AI specialty-classification fallback was retired with
      // the English-only refocus (Req 8.5 — SPECIALTY_CLASSIFY removed).
      // We log the low-confidence result and still use the rule-based
      // winner so the teacher always lands on a dashboard
      // (Requirement 2.3 + 2.5).
      this.logger.warn(
        `AI fallback would run here for teacher ${teacherUserId} ` +
          `(confidence=${classification.confidence.toFixed(2)} < ${AI_FALLBACK_THRESHOLD})`,
      );
      usedAiFallback = true;
    }

    // Resolve the winning specialty (must be seeded in the catalog)
    const specialty = await this.specialtyService.findBySlug(classification.specialtySlug);
    if (!specialty) {
      throw new NotFoundException({
        code: 'SPECIALTY_NOT_FOUND',
        message: `Resolved specialty "${classification.specialtySlug}" is not present in the catalog`,
      });
    }

    // Persist answers + profile in a single transaction so that a teacher
    // either has BOTH their answers stored AND a profile pointing at the
    // resolved specialty, or NEITHER. This protects Requirement 2.5
    // ("har bir o'qituvchiga faqat bitta specialty").
    await this.prisma.$transaction(async (tx) => {
      for (const answer of dto.answers) {
        await tx.onboardingAnswer.upsert({
          where: {
            teacherId_questionId: {
              teacherId: teacherUserId,
              questionId: answer.questionId,
            },
          },
          create: {
            teacherId: teacherUserId,
            questionId: answer.questionId,
            selectedOptionId: answer.selectedOptionId,
          },
          update: {
            selectedOptionId: answer.selectedOptionId,
          },
        });
      }

      await this.teacherProfileRepository.upsertWithSpecialty(
        {
          userId: teacherUserId,
          specialtyId: specialty.id,
          fullName: teacherFullName,
        },
        tx,
      );
    });

    this.logger.log(
      `Teacher ${teacherUserId} onboarded → specialty=${specialty.slug} ` +
        `(confidence=${classification.confidence.toFixed(2)}, aiFallback=${usedAiFallback})`,
    );

    return {
      specialty: this.toSpecialtyDto(specialty),
      dashboardUrl: `/dashboard/${specialty.dashboardKey}`,
      confidence: classification.confidence,
      usedAiFallback,
    };
  }

  /**
   * Rule-based specialty classifier.
   *
   * Algorithm:
   *   - For every (questionId, selectedOptionId) pair, look up the selected
   *     option's `weights` map and add each value to a running per-slug total.
   *   - The winner is the slug with the largest total.
   *   - Confidence is `winner_total / sum(all_totals)`. When no answer carried
   *     any weights (e.g. the catalog hasn't been seeded), confidence is 0.
   *   - Tie-breaking is alphabetical by slug for determinism so identical
   *     inputs always produce identical outputs (important for tests).
   */
  classify(
    dto: SubmitAnswersDto,
    questionsById: Map<string, OnboardingQuestion>,
  ): ClassifyResult {
    const totals: Record<string, number> = {};

    for (const answer of dto.answers) {
      const question = questionsById.get(answer.questionId);
      if (!question) continue;

      const options = this.parseOptions(question.optionsJson);
      const selected = options.find((o) => o.id === answer.selectedOptionId);
      if (!selected || !selected.weights) continue;

      for (const [slug, raw] of Object.entries(selected.weights)) {
        const weight = Number(raw);
        if (!Number.isFinite(weight) || weight < 0) continue;
        totals[slug] = (totals[slug] ?? 0) + weight;
      }
    }

    const sum = Object.values(totals).reduce((acc, v) => acc + v, 0);

    if (sum === 0) {
      // No information at all — pick a deterministic placeholder so the AI
      // fallback path will fire and the controller still gets a slug.
      return {
        specialtySlug: '__unknown__',
        confidence: 0,
        totals,
      };
    }

    // Pick winner with deterministic alphabetical tie-break
    let winnerSlug = '';
    let winnerScore = -1;
    for (const slug of Object.keys(totals).sort()) {
      const score = totals[slug] ?? 0;
      if (score > winnerScore) {
        winnerSlug = slug;
        winnerScore = score;
      }
    }

    return {
      specialtySlug: winnerSlug,
      confidence: winnerScore / sum,
      totals,
    };
  }

  private toQuestionDto(
    question: OnboardingQuestion,
    locale: OnboardingLocale,
  ): OnboardingQuestionDto {
    // New format: { multiSelect: boolean, options: [...] }
    // Old format: [...] (array directly)
    const raw = question.optionsJson as any;
    const isNewFormat = raw && typeof raw === 'object' && !Array.isArray(raw) && 'options' in raw;
    const multiSelect = isNewFormat ? Boolean(raw.multiSelect) : false;
    const rawOptions = isNewFormat ? raw.options : raw;

    const options = (Array.isArray(rawOptions) ? rawOptions : []).map((opt: any) => ({
      id: opt.id,
      text: this.pickLocalizedText(opt.text, locale, ''),
    }));

    return {
      id: question.id,
      order: question.order,
      specialtyId: question.specialtyId,
      multiSelect,
      text: this.pickLocalizedText(
        { uz: question.textUz, ru: question.textRu, en: question.textEn },
        locale,
        question.textUz,
      ),
      options,
    };
  }

  private toSpecialtyDto(specialty: Specialty) {
    return {
      id: specialty.id,
      slug: specialty.slug,
      nameUz: specialty.nameUz,
      nameRu: specialty.nameRu,
      nameEn: specialty.nameEn,
    };
  }

  /**
   * `OnboardingQuestion.optionsJson` is stored as Prisma `Json`, which means
   * Prisma can hand us anything from a string to a number to an object. We
   * defensively parse it into the expected shape and silently drop malformed
   * entries.
   */
  private parseOptions(value: Prisma.JsonValue): QuestionOption[] {
    if (!Array.isArray(value)) return [];
    const out: QuestionOption[] = [];
    for (const raw of value) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const obj = raw as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : null;
      if (!id) continue;
      const option: QuestionOption = {
        id,
        text: this.coerceText(obj.text),
      };
      const weights = this.coerceWeights(obj.weights);
      if (weights) option.weights = weights;
      out.push(option);
    }
    return out;
  }

  private coerceText(value: unknown): QuestionOption['text'] {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      return {
        uz: typeof o.uz === 'string' ? o.uz : '',
        ru: typeof o.ru === 'string' ? o.ru : '',
        en: typeof o.en === 'string' ? o.en : '',
      };
    }
    return '';
  }

  private coerceWeights(value: unknown): Record<string, number> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const out: Record<string, number> = {};
    for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
      const n = Number(raw);
      if (Number.isFinite(n)) out[slug] = n;
    }
    return out;
  }

  private pickLocalizedText(
    text: QuestionOption['text'],
    locale: OnboardingLocale,
    fallback: string,
  ): string {
    if (typeof text === 'string') return text;
    return text[locale] || text.uz || text.en || text.ru || fallback;
  }

  /**
   * Get teacher profile for the dashboard onboarding check.
   * Returns null if no profile exists.
   */
  async getTeacherProfile(teacherId: string) {
    const profile = await this.teacherProfileRepository.findByUserId(teacherId);
    if (!profile) return null;
    return {
      userId: profile.userId,
      specialtyId: profile.specialtyId,
      onboardingCompletedAt: profile.onboardingCompletedAt,
    };
  }

  /**
   * Ensure the teacher has a profile assigned to the single English
   * specialty.
   *
   * Bilgim is an English-only platform, so there is no subject quiz: every
   * teacher teaches English. This idempotently provisions (or repairs) the
   * TeacherProfile with the seeded `english` specialty and marks onboarding as
   * complete, so the dashboard never has to send the teacher through a quiz.
   */
  async ensureDefaultSpecialty(
    teacherUserId: string,
    teacherFullName: string | null,
  ) {
    const existing = await this.teacherProfileRepository.findByUserId(
      teacherUserId,
    );
    if (existing?.specialtyId) {
      return {
        userId: existing.userId,
        specialtyId: existing.specialtyId,
        onboardingCompletedAt: existing.onboardingCompletedAt,
      };
    }

    const specialty = await this.specialtyService.findBySlug('english');
    if (!specialty) {
      throw new NotFoundException({
        code: 'SPECIALTY_NOT_FOUND',
        message: 'The "english" specialty is not present in the catalog. Run the DB seed.',
      });
    }

    const profile = await this.teacherProfileRepository.upsertWithSpecialty({
      userId: teacherUserId,
      specialtyId: specialty.id,
      fullName: teacherFullName,
    });

    this.logger.log(
      `Teacher ${teacherUserId} auto-assigned English specialty (onboarding skipped)`,
    );

    return {
      userId: profile.userId,
      specialtyId: profile.specialtyId,
      onboardingCompletedAt: profile.onboardingCompletedAt,
    };
  }
}
