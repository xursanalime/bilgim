-- Task 24.2 — performance indexes for hot read paths.
--
-- Each index extends an existing partial cover so the query planner can stay
-- on an index-only scan for the dashboards / oversight panels that hit these
-- tables hardest.
--
-- Why these four:
--   * Submission(assignmentId, status) — teacher review queue ("ungraded
--     submissions for assignment X"). Existing (studentId, status) covered
--     the student dashboard but not the teacher's grading flow.
--   * Notification(userId, readAt, createdAt DESC) — in-app feed sorts
--     unread first then newest. Adding `createdAt` to the existing
--     (userId, readAt) eliminates the post-fetch sort.
--   * Invoice(teacherId, status, paidAt DESC) — revenue dashboard / trend
--     trailing-N-days lookup. The DESC sort on `paidAt` lets the same index
--     answer "what did this teacher get paid most recently".
--   * AiCall(intent, status, createdAt DESC) — admin AI oversight panel
--     filters by intent + status and orders newest first.

-- CreateIndex
CREATE INDEX "Submission_assignmentId_status_idx" ON "Submission"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Invoice_teacherId_status_paidAt_idx" ON "Invoice"("teacherId", "status", "paidAt" DESC);

-- CreateIndex
CREATE INDEX "AiCall_intent_status_createdAt_idx" ON "AiCall"("intent", "status", "createdAt" DESC);
