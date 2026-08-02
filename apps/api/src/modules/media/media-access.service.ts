import { ForbiddenException, Injectable } from '@nestjs/common';
import { MediaAsset, PrismaClient } from '@prisma/client';

/**
 * The minimal slice of a JWT we need for media access decisions.
 *
 * We mirror the shape used by `LessonAccessGuard` so the predicates here
 * match the catalog-level rules (Req 6.1 – 6.6) and stay easy to reason
 * about as the same person.
 */
export interface MediaAccessActor {
  sub: string;
  role: string;
}

interface LessonReference {
  groupId: string;
  teacherId: string;
}

/**
 * MediaAccessService — encapsulates the read-side authorization rule for
 * `MediaAsset` (Req 8.8, 21.6) without the controller having to know the
 * data model.
 *
 * A user MAY read a `MediaAsset` iff one of the following holds:
 *
 *   1. They are the **owner** (`asset.ownerUserId === actor.sub`). The
 *      teacher who uploaded the file always retains read access — even
 *      before the asset is attached to a lesson.
 *
 *   2. They are an **ADMIN** (read-only audit access — mirrors the
 *      `LessonAccessGuard` rule for Req 6.4).
 *
 *   3. They are a **TEACHER** who owns at least one Lesson that
 *      references this asset via `Attachment` or `Recording`. This is
 *      the same "owns the course" predicate enforced by
 *      `LessonAccessGuard` for the catalog read paths.
 *
 *   4. They are a **STUDENT** with an `APPROVED` `Enrollment` in any
 *      group whose Lesson references this asset (via `Attachment` or
 *      `Recording`). The same predicate `LessonAccessGuard` enforces on
 *      `GET /catalog/lessons/:id` (Req 6.1, 6.2, 6.6).
 *
 * Everything else is denied with `MEDIA_ACCESS_DENIED` (403).
 */
@Injectable()
export class MediaAccessService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Throws `ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' })` unless
   * the actor satisfies one of the predicates above.
   */
  async assertCanRead(
    actor: MediaAccessActor,
    asset: MediaAsset,
  ): Promise<void> {
    // (1) Owner fast-path — no DB hit beyond the asset lookup.
    if (asset.ownerUserId === actor.sub) {
      return;
    }

    // (2) Admin read-only audit access (Req 6.4 mirror).
    if (actor.role === 'ADMIN') {
      return;
    }

    // (5) Chat participants (Task 13.x mirror).
    // If the asset is attached to a chat message, anyone in that room
    // can read it.
    const chatRef = await this.prisma.chatMessage.findFirst({
      where: { assetId: asset.id },
      select: { room: { select: { scopeRef: true } } },
    });
    if (chatRef) {
      const participants = chatRef.room.scopeRef.split(':');
      if (participants.includes(actor.sub)) {
        return;
      }
    }

    // For everyone else, look for a Lesson that references the asset.
    // An orphan asset (no Attachment / Recording) is reachable only by
    // its owner — we already covered that branch above.
    const refs = await this.findLessonReferences(asset.id);
    if (refs.length === 0) {
      this.deny();
    }

    if (actor.role === 'TEACHER') {
      // (3) Teacher must own the course of at least one referencing lesson.
      const ownsAny = refs.some((ref) => ref.teacherId === actor.sub);
      if (ownsAny) {
        return;
      }
      this.deny();
    }

    if (actor.role === 'STUDENT') {
      // (4) Student must have an APPROVED enrollment for at least one
      // referencing lesson's group.
      const groupIds = Array.from(new Set(refs.map((r) => r.groupId)));
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          studentId: actor.sub,
          status: 'APPROVED',
          groupId: { in: groupIds },
        },
        select: { id: true },
      });
      if (enrollment) {
        return;
      }
      this.deny();
    }

    // Unknown role (defense in depth — RBAC at the controller already
    // restricts this list, but never trust a single layer).
    this.deny();
  }

  /**
   * Resolve every Lesson that references this asset, projected down to
   * the parent group + course teacher. We query both `Attachment` (lesson
   * materials) and `Recording` (live-session recordings) — both can be
   * reached via the lesson player.
   */
  private async findLessonReferences(
    assetId: string,
  ): Promise<LessonReference[]> {
    const [attachments, recordings] = await Promise.all([
      this.prisma.attachment.findMany({
        where: { assetId },
        select: {
          lesson: {
            select: {
              groupId: true,
              group: {
                select: { course: { select: { teacherId: true } } },
              },
            },
          },
        },
      }),
      this.prisma.recording.findMany({
        where: { assetId },
        select: {
          lesson: {
            select: {
              groupId: true,
              group: {
                select: { course: { select: { teacherId: true } } },
              },
            },
          },
        },
      }),
    ]);

    const refs: LessonReference[] = [];
    for (const a of attachments) {
      if (a.lesson) {
        refs.push({
          groupId: a.lesson.groupId,
          teacherId: a.lesson.group.course.teacherId,
        });
      }
    }
    for (const r of recordings) {
      if (r.lesson) {
        refs.push({
          groupId: r.lesson.groupId,
          teacherId: r.lesson.group.course.teacherId,
        });
      }
    }
    return refs;
  }

  private deny(): never {
    throw new ForbiddenException({
      code: 'MEDIA_ACCESS_DENIED',
      message: 'You do not have access to this media asset',
    });
  }
}
