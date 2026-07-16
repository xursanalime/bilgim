-- Add ENROLLMENT_REQUESTED to the NotificationKind enum so teachers can be
-- notified when a student submits a direct join request.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ENROLLMENT_REQUESTED' BEFORE 'ENROLLMENT_APPROVED';
