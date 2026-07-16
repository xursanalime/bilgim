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
  /**
   * Server-authoritative Download_Permission for the owning group
   * (content-protection-backend Req 4.2 – 4.4). When false a learner
   * may only stream the file inline, never as an attachment.
   */
  downloadAllowed: boolean;
}

/**
 * Outcome of {@link MediaAccessService.resolveStreamAccess}: the caller
 * is entitled (otherwise the method throws), plus the server-side
 * decision on whether a download/attachment response is permitted.
 */
export interface MediaStreamGrant {
  downloadAllowed: boolean;
}

/**
 * Outcome of {@link MediaAccessService.resolvePlaybackAccess}: the caller
 * is entitled (otherwise the method throws), the server-side
 * Download_Permission decision, and — for an enrolled STUDENT — the
 * APPROVED `Enrollment.id` that granted access. The enrollment id is the
 * forensic-watermark identity source consumed by the
 * `PlaybackTicketService` (content-protection-backend Req 3.1); it is
 * absent for owners / admins / owning teachers who reach the asset
 * without an enrollment.
 */
export interface MediaPlaybackGrant {
  downloadAllowed: boolean;
  enrollmentId?: string;
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
   * Resolve gated-streaming access for a `MediaAsset`
   * (content-protection-backend Req 4.1 – 4.4).
   *
   * Two server-side decisions are made here, in order:
   *
   *   1. **Entitlement** — reuses {@link assertCanRead}, the same
   *      predicate enforced for playback. A caller without an APPROVED
   *      Entitlement (or owner/admin/owning-teacher access) is rejected
   *      with `403 MEDIA_ACCESS_DENIED` before any byte is streamed
   *      (Req 4.1 / 4.4).
   *
   *   2. **Download_Permission** — whether the response may be served as
   *      an attachment (download) vs inline-only (Req 4.2 / 4.3). The
   *      decision is derived purely from server state, never from a
   *      client flag:
   *
   *        - Asset owner, ADMIN, and the owning TEACHER manage the
   *          content and may always download it.
   *        - A STUDENT may download only when a group they hold an
   *          APPROVED enrollment in has `downloadAllowed = true`. While
   *          it is disabled the file is inline-only, regardless of any
   *          client-provided flag (Property 3 — download gating is
   *          server-enforced).
   */
  async resolveStreamAccess(
    actor: MediaAccessActor,
    asset: MediaAsset,
  ): Promise<MediaStreamGrant> {
    // (1) Entitlement gate — throws 403 for non-entitled callers.
    await this.assertCanRead(actor, asset);

    // (2) Download_Permission. Content managers may always download.
    if (asset.ownerUserId === actor.sub || actor.role === 'ADMIN') {
      return { downloadAllowed: true };
    }

    const refs = await this.findLessonReferences(asset.id);

    // A TEACHER only reaches this point if `assertCanRead` confirmed they
    // own a referencing lesson — content managers may download.
    if (actor.role === 'TEACHER') {
      const ownsAny = refs.some((ref) => ref.teacherId === actor.sub);
      return { downloadAllowed: ownsAny };
    }

    if (actor.role === 'STUDENT') {
      const groupIds = Array.from(new Set(refs.map((r) => r.groupId)));
      if (groupIds.length === 0) {
        return { downloadAllowed: false };
      }
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          studentId: actor.sub,
          status: 'APPROVED',
          groupId: { in: groupIds },
        },
        select: { groupId: true },
      });
      const enrolledGroupIds = new Set(enrollments.map((e) => e.groupId));
      // Download is allowed only when a group the student is actually
      // enrolled in has Download_Permission enabled (Req 4.2 – 4.4).
      const downloadAllowed = refs.some(
        (ref) => enrolledGroupIds.has(ref.groupId) && ref.downloadAllowed,
      );
      return { downloadAllowed };
    }

    // Any other actor (e.g. chat participant) is inline-only.
    return { downloadAllowed: false };
  }

  /**
   * Resolve playback access for a `MediaAsset`
   * (content-protection-backend Req 1.2, 3.1).
   *
   * Reuses the SAME entitlement predicate as playback / gated streaming
   * ({@link assertCanRead}) — there is no separate "playback entitlement"
   * model. A caller without an APPROVED Entitlement (or owner / admin /
   * owning-teacher access) is rejected with `403 MEDIA_ACCESS_DENIED`
   * before any ticket material is produced (Req 1.2, design Property 1).
   *
   * On success it returns the server-authoritative Download_Permission
   * (identical decision to {@link resolveStreamAccess}) plus, for an
   * enrolled STUDENT, the APPROVED `Enrollment.id` used to derive the
   * forensic watermark identity (Req 3.1). Owners / admins / owning
   * teachers carry no enrollment, so `enrollmentId` is omitted for them.
   */
  async resolvePlaybackAccess(
    actor: MediaAccessActor,
    asset: MediaAsset,
  ): Promise<MediaPlaybackGrant> {
    // (1) Entitlement gate — throws 403 for non-entitled callers BEFORE
    //     any media reference / ticket material is created.
    await this.assertCanRead(actor, asset);

    // (2) Content managers may always download and carry no enrollment.
    if (asset.ownerUserId === actor.sub || actor.role === 'ADMIN') {
      return { downloadAllowed: true };
    }

    const refs = await this.findLessonReferences(asset.id);

    if (actor.role === 'TEACHER') {
      const ownsAny = refs.some((ref) => ref.teacherId === actor.sub);
      return { downloadAllowed: ownsAny };
    }

    if (actor.role === 'STUDENT') {
      const groupIds = Array.from(new Set(refs.map((r) => r.groupId)));
      if (groupIds.length === 0) {
        return { downloadAllowed: false };
      }
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          studentId: actor.sub,
          status: 'APPROVED',
          groupId: { in: groupIds },
        },
        select: { id: true, groupId: true },
      });
      const enrolledGroupIds = new Set(enrollments.map((e) => e.groupId));
      const downloadAllowed = refs.some(
        (ref) => enrolledGroupIds.has(ref.groupId) && ref.downloadAllowed,
      );
      const grant: MediaPlaybackGrant = { downloadAllowed };
      const enrollmentId = enrollments[0]?.id;
      if (enrollmentId) {
        grant.enrollmentId = enrollmentId;
      }
      return grant;
    }

    return { downloadAllowed: false };
  }

  /**
   * Resolve every Lesson that references this asset, projected down to
   * the parent group + course teacher. We query both `Attachment` (lesson
   * materials) and `Recording` (live-session recordings) — both can be
   * reached via the lesson player.
   */
  /** Dars materialiga biriktirilgan asset-mi? (chat vs lesson farqlash) */
  async hasLessonReference(assetId: string): Promise<boolean> {
    const ref = await this.prisma.attachment.findFirst({
      where: { assetId },
      select: { id: true },
    });
    return ref !== null;
  }

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
                select: {
                  downloadAllowed: true,
                  course: { select: { teacherId: true } },
                },
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
                select: {
                  downloadAllowed: true,
                  course: { select: { teacherId: true } },
                },
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
          downloadAllowed: a.lesson.group.downloadAllowed ?? false,
        });
      }
    }
    for (const r of recordings) {
      if (r.lesson) {
        refs.push({
          groupId: r.lesson.groupId,
          teacherId: r.lesson.group.course.teacherId,
          downloadAllowed: r.lesson.group.downloadAllowed ?? false,
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
