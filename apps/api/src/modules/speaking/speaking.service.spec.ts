import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HomeworkModuleType, Submission } from '@prisma/client';

import { MediaService, type UploadInitiated } from '../media/media.service';
import { SpeakingSubmissionRepository } from './repositories/speaking-submission.repository';
import { SpeakingActor, SpeakingService } from './speaking.service';
import {
  SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES,
  SPEAKING_AUDIO_MAX_SIZE_BYTES,
} from './speaking.types';

/**
 * Unit tests for SpeakingService (Task 4.1, Req 7.1, 7.2, 7.7).
 *
 * Cover:
 *   - audio content-type allowlist accept / reject (Req 7.7)
 *   - AUDIO MediaAsset creation + association with the learner's
 *     Submission via the per-module answersJson slice (Req 7.2)
 *   - module-type guard (SPEAKING / PRONUNCIATION only — Req 7.1)
 *   - enrolled-learner authorization
 */
describe('SpeakingService', () => {
  let service: SpeakingService;
  let media: jest.Mocked<Pick<MediaService, 'initiateUpload'>>;
  let repo: jest.Mocked<
    Pick<
      SpeakingSubmissionRepository,
      | 'findModuleContext'
      | 'findApprovedEnrollment'
      | 'getOrCreateDraftSubmission'
      | 'updateAnswers'
    >
  >;

  const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
  const ASSIGNMENT_ID = '22222222-2222-2222-2222-222222222222';
  const MODULE_ID = '33333333-3333-3333-3333-333333333333';
  const GROUP_ID = '44444444-4444-4444-4444-444444444444';
  const ENROLLMENT_ID = '55555555-5555-5555-5555-555555555555';
  const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';
  const ASSET_ID = '77777777-7777-7777-7777-777777777777';
  const TEACHER_ID = '88888888-8888-8888-8888-888888888888';

  const student: SpeakingActor = { userId: STUDENT_ID, role: 'STUDENT' };

  function buildContext(
    overrides: Partial<{
      moduleType: HomeworkModuleType;
      isPublished: boolean;
    }> = {},
  ) {
    return {
      moduleId: MODULE_ID,
      moduleType: (overrides.moduleType ?? 'SPEAKING') as HomeworkModuleType,
      assignmentId: ASSIGNMENT_ID,
      isPublished: overrides.isPublished ?? true,
      lessonId: 'lesson-1',
      groupId: GROUP_ID,
      teacherId: TEACHER_ID,
    };
  }

  function buildSubmission(
    overrides: Partial<Submission> = {},
  ): Submission {
    return {
      id: SUBMISSION_ID,
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      enrollmentId: ENROLLMENT_ID,
      status: 'DRAFT',
      answersJson: {},
      score: null,
      aiFlagged: false,
      aiLikelihood: null,
      submittedAt: null,
      gradedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Submission;
  }

  function buildUpload(): UploadInitiated {
    return {
      assetId: ASSET_ID,
      uploadId: 'r2-upload-id',
      key: `media/${STUDENT_ID}/audio/2025/01/abc-answer.webm`,
      partUrls: [{ partNumber: 1, url: 'https://r2.example/part-1' }] as any,
      expiresInSeconds: 900,
      partSizeBytes: 8 * 1024 * 1024,
    };
  }

  const validDto = {
    fileName: 'answer.webm',
    contentType: 'audio/webm',
    sizeBytes: 1024 * 1024,
    partsCount: 1,
  };

  beforeEach(() => {
    media = { initiateUpload: jest.fn().mockResolvedValue(buildUpload()) };
    repo = {
      findModuleContext: jest.fn().mockResolvedValue(buildContext()),
      findApprovedEnrollment: jest
        .fn()
        .mockResolvedValue({ id: ENROLLMENT_ID }),
      getOrCreateDraftSubmission: jest
        .fn()
        .mockResolvedValue(buildSubmission()),
      updateAnswers: jest
        .fn()
        .mockImplementation(async (_id: string, answersJson: unknown) =>
          buildSubmission({ answersJson: answersJson as any }),
        ),
    };

    service = new SpeakingService(
      media as unknown as MediaService,
      repo as unknown as SpeakingSubmissionRepository,
    );
  });

  // ----------------------------------------------------------------
  // Allowlist accept (Req 7.7) + asset association (Req 7.2)
  // ----------------------------------------------------------------

  it.each([...SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES])(
    'accepts allowlisted audio content type %s and creates an AUDIO MediaAsset',
    async (contentType) => {
      const result = await service.submitAudio(
        student,
        ASSIGNMENT_ID,
        MODULE_ID,
        { ...validDto, contentType },
      );

      expect(media.initiateUpload).toHaveBeenCalledTimes(1);
      expect(media.initiateUpload).toHaveBeenCalledWith(
        STUDENT_ID,
        expect.objectContaining({ kind: 'AUDIO', contentType }),
      );
      expect(result.assetId).toBe(ASSET_ID);
      expect(result.submissionId).toBe(SUBMISSION_ID);
      expect(result.upload.uploadId).toBe('r2-upload-id');
    },
  );

  it('associates the created AUDIO asset with the submission under the module id (Req 7.2)', async () => {
    await service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto);

    expect(repo.updateAnswers).toHaveBeenCalledTimes(1);
    const [submissionId, answersJson] = repo.updateAnswers.mock.calls[0]!;
    expect(submissionId).toBe(SUBMISSION_ID);
    expect(answersJson).toMatchObject({
      [MODULE_ID]: {
        kind: 'AUDIO',
        assetId: ASSET_ID,
        contentType: 'audio/webm',
      },
    });
  });

  it('preserves other modules answers when associating the audio slice', async () => {
    repo.getOrCreateDraftSubmission.mockResolvedValueOnce(
      buildSubmission({
        answersJson: { 'other-module': { text: 'keep me' } } as any,
      }),
    );

    await service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto);

    const [, answersJson] = repo.updateAnswers.mock.calls[0]!;
    expect(answersJson).toMatchObject({
      'other-module': { text: 'keep me' },
      [MODULE_ID]: { kind: 'AUDIO', assetId: ASSET_ID },
    });
  });

  it('accepts PRONUNCIATION modules as well as SPEAKING', async () => {
    repo.findModuleContext.mockResolvedValueOnce(
      buildContext({ moduleType: 'PRONUNCIATION' }),
    );

    const result = await service.submitAudio(
      student,
      ASSIGNMENT_ID,
      MODULE_ID,
      validDto,
    );
    expect(result.assetId).toBe(ASSET_ID);
    expect(media.initiateUpload).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------
  // Allowlist reject (Req 7.7)
  // ----------------------------------------------------------------

  it.each(['video/mp4', 'application/pdf', 'image/png', 'text/plain', 'audio/aac'])(
    'rejects non-allowlisted content type %s without creating an asset (Req 7.7)',
    async (contentType) => {
      await expect(
        service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, {
          ...validDto,
          contentType,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(media.initiateUpload).not.toHaveBeenCalled();
      expect(repo.updateAnswers).not.toHaveBeenCalled();
    },
  );

  it('rejects recordings larger than the audio size cap', async () => {
    await expect(
      service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, {
        ...validDto,
        sizeBytes: SPEAKING_AUDIO_MAX_SIZE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(media.initiateUpload).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Module-type guard (Req 7.1)
  // ----------------------------------------------------------------

  it('rejects a non-speaking module type with MODULE_TYPE_NOT_SPEAKING', async () => {
    repo.findModuleContext.mockResolvedValueOnce(
      buildContext({ moduleType: 'WRITING' }),
    );

    await expect(
      service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(media.initiateUpload).not.toHaveBeenCalled();
  });

  it('rejects when the module/assignment does not exist', async () => {
    repo.findModuleContext.mockResolvedValueOnce(null);

    await expect(
      service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the assignment is not published', async () => {
    repo.findModuleContext.mockResolvedValueOnce(
      buildContext({ isPublished: false }),
    );

    await expect(
      service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(media.initiateUpload).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Authorization
  // ----------------------------------------------------------------

  it('rejects a learner without an APPROVED enrollment', async () => {
    repo.findApprovedEnrollment.mockResolvedValueOnce(null);

    await expect(
      service.submitAudio(student, ASSIGNMENT_ID, MODULE_ID, validDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(media.initiateUpload).not.toHaveBeenCalled();
  });

  it.each(['TEACHER', 'ADMIN'] as const)(
    'rejects %s — only the enrolled learner may submit',
    async (role) => {
      await expect(
        service.submitAudio(
          { userId: TEACHER_ID, role },
          ASSIGNMENT_ID,
          MODULE_ID,
          validDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findModuleContext).not.toHaveBeenCalled();
      expect(media.initiateUpload).not.toHaveBeenCalled();
    },
  );
});
