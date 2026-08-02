-- roomId is derived from lessonId and reused every time a lesson's live
-- session restarts (see LiveKitService.ensureRoom(lessonId)). A global
-- UNIQUE constraint on roomId therefore blocks a lesson from ever starting
-- a second live session once the first one has ended, since the ENDED row
-- keeps the value forever. Replace it with a partial unique index that
-- only enforces exclusivity among *active* (non-terminal) sessions, which
-- is what the constraint was actually protecting against (a concurrent
-- double-start for the same lesson).

DROP INDEX "LiveSession_roomId_key";

CREATE UNIQUE INDEX "LiveSession_active_roomId_key" ON "LiveSession" ("roomId") WHERE status IN ('SCHEDULED', 'STARTING', 'LIVE');
