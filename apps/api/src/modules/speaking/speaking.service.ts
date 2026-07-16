import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MediaService, type UploadInitiated } from '../media/media.service';
import { SubmitSpeakingAudioDto } from './dto';
import { SpeakingSubmissionRepository } from './repositories/speaking-submission.repository';
import {
  SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES,
  SPEAKING_AUDIO_MAX_SIZE_BYTES,
  type SpeakingAudioAnswer,
  isAllowedSpeakingAudioContentType,
  isSpeakingModuleType,
} from './speaking.types';

/** JWT roles relevant to the speaking submission flow. */
type SpeakingActorRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface SpeakingActor {
  userId: string;
  role: SpeakingActorRole;
}

/**
 * Response returned when a learner registers an audio recording for a
 * speaking/pronunciation module. Carries the created AUDIO MediaAsset id
 * plus the signed multipart-upload handles the client uses to PUT the
 * recording to storage (reused verbatim from the Media_Module upload
 * lifecycle).
 */
export interface SpeakingAudioSubmission {
  submissionId: string;
  moduleId: string;
  assetId: string;
  upload: {
    uploadId: string;
    key: string;
    partUrls: UploadInitiated['partUrls'];
    partSizeBytes: number;
    expiresInSeconds: number;
  };
}

/**
 * SpeakingService — accepts a learner's audio answer for a SPEAKING or
 * PRONUNCIATION assignment module and stores it as an AUDIO MediaAsset
 * associated with the learner's Submission (Phase 4, Req 7.1, 7.2, 7.7).
 *
 * Scope (Task 4.1 — NO AI scoring, that is Task 4.2):
 *   1. Validate the audio content type against the Media_Module allowlist
 *      (Req 7.7). Rejected types never reach storage.
 *   2. Confirm the target module is a SPEAKING/PRONUNCIATION type (Req 7.1).
 *   3. Authorize: only the enrolled learner (APPROVED enrollment in the
 *      parent group) for that assignment may submit.
 *   4. Reuse the Media_Module multipart upload to create the AUDIO
 *      MediaAsset (no bespoke storage), then link the asset to the
 *      learner's DRAFT Submission via the per-module `answersJson` slice
 *      (Req 7.2).
 */
@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(
    private readonly mediaService: MediaService,
    private readonly submissions: SpeakingSubmissionRepository,
  ) {}

  /**
   * Register an audio recording for `(assignmentId, moduleId)` on behalf
   * of the enrolled learner.
   */
  async submitAudio(
    actor: SpeakingActor,
    assignmentId: string,
    moduleId: string,
    dto: SubmitSpeakingAudioDto,
  ): Promise<SpeakingAudioSubmission> {
    // 0. Only a learner submits their own audio answer. Teachers grade /
    //    override (Task 4.2); admins moderate — neither creates a
    //    learner's submission here.
    if (actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Only the enrolled learner can submit a speaking recording',
      });
    }

    // 1. Allowlist check FIRST (Req 7.7) — a rejected content type must
    //    never create a MediaAsset or touch storage.
    this.assertAudioContentTypeAllowed(dto.contentType);
    this.assertAudioSizeWithinCap(dto.sizeBytes);

    // 2. Resolve the module + ownership chain and validate the type.
    const context = await this.submissions.findModuleContext(
      assignmentId,
      moduleId,
    );
    if (!context) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_MODULE_NOT_FOUND',
        message: `Module ${moduleId} not found on assignment ${assignmentId}`,
      });
    }
    if (!isSpeakingModuleType(context.moduleType)) {
      throw new BadRequestException({
        code: 'MODULE_TYPE_NOT_SPEAKING',
        message:
          'Audio recordings are only accepted for SPEAKING or PRONUNCIATION modules',
        details: { moduleType: context.moduleType },
      });
    }
    if (!context.isPublished) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_PUBLISHED',
        message:
          'Recordings are only accepted for published assignments. Wait for the instructor to publish.',
      });
    }

    // 3. Authorize the enrolled learner (Req 7.1).
    const enrollment = await this.submissions.findApprovedEnrollment(
      context.groupId,
      actor.userId,
    );
    if (!enrollment) {
      throw new ForbiddenException({
        code: 'LESSON_ACCESS_DENIED',
        message:
          'You must have an APPROVED enrollment in this group to submit a recording',
      });
    }

    // 4. Idempotently resolve the learner's DRAFT submission.
    const submission = await this.submissions.getOrCreateDraftSubmission({
      assignmentId,
      studentId: actor.userId,
      enrollmentId: enrollment.id,
    });

    // 5. Reuse the Media_Module multipart upload to create the AUDIO
    //    MediaAsset (Req 7.2). MediaService re-validates the content
    //    type against the same allowlist as defence in depth.
    const upload = await this.mediaService.initiateUpload(actor.userId, {
      fileName: dto.fileName,
      kind: 'AUDIO',
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      partsCount: dto.partsCount,
    });

    // 6. Associate the asset with the submission (Req 7.2) by writing the
    //    audio answer slice under the speaking module's id, preserving
    //    any other modules' answers already on the row.
    const audioAnswer: SpeakingAudioAnswer = {
      kind: 'AUDIO',
      assetId: upload.assetId,
      contentType: dto.contentType,
      fileName: dto.fileName,
      status: 'UPLOADING',
      registeredAt: new Date().toISOString(),
    };
    const mergedAnswers = {
      ...this.coerceAnswersObject(submission.answersJson),
      [moduleId]: audioAnswer,
    };
    await this.submissions.updateAnswers(
      submission.id,
      mergedAnswers as Prisma.InputJsonValue,
    );

    this.logger.log(
      `Speaking audio registered: submission=${submission.id} module=${moduleId} ` +
        `asset=${upload.assetId} (${dto.contentType})`,
    );

    return {
      submissionId: submission.id,
      moduleId,
      assetId: upload.assetId,
      upload: {
        uploadId: upload.uploadId,
        key: upload.key,
        partUrls: upload.partUrls,
        partSizeBytes: upload.partSizeBytes,
        expiresInSeconds: upload.expiresInSeconds,
      },
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Reject any content type outside the audio allowlist (Req 7.7). */
  private assertAudioContentTypeAllowed(contentType: string): void {
    if (!isAllowedSpeakingAudioContentType(contentType)) {
      throw new BadRequestException({
        code: 'SPEAKING_AUDIO_CONTENT_TYPE_NOT_ALLOWED',
        message: `${contentType} is not an allowed audio content type`,
        details: { allowed: [...SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES] },
      });
    }
  }

  private assertAudioSizeWithinCap(sizeBytes: number): void {
    if (sizeBytes > SPEAKING_AUDIO_MAX_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'SPEAKING_AUDIO_TOO_LARGE',
        message: `Recording exceeds the ${SPEAKING_AUDIO_MAX_SIZE_BYTES}-byte cap`,
      });
    }
  }

  /**
   * Coerce the stored `answersJson` into a plain object we can spread.
   * A non-object (null / array / scalar) is treated as an empty record so
   * a malformed row never blocks a fresh audio answer.
   */
  private coerceAnswersObject(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
