-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================
-- Partial unique index: one non-terminal subscription per teacher
-- Only one TRIAL/ACTIVE/PAST_DUE subscription allowed per teacher at a time
-- ============================================================
CREATE UNIQUE INDEX subscriptions_teacher_active_uniq
ON "subscriptions" ("teacherId")
WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE');

-- ============================================================
-- pg_trgm GIN indexes for full-text / trigram search (discovery)
-- ============================================================
CREATE INDEX teacher_profile_fullname_trgm_idx
  ON "TeacherProfile" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX teacher_profile_headline_trgm_idx
  ON "TeacherProfile" USING GIN (headline gin_trgm_ops);

CREATE INDEX course_title_trgm_idx
  ON "Course" USING GIN (title gin_trgm_ops);

CREATE INDEX group_name_trgm_idx
  ON "Group" USING GIN (name gin_trgm_ops);

-- ============================================================
-- Constraint trigger: enforce max 10 active SpecialtyModule per Specialty
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_specialty_module_cap() RETURNS trigger AS $$
DECLARE active_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM "SpecialtyModule"
  WHERE "specialtyId" = NEW."specialtyId" AND "isActive" = true;

  IF active_count > 10 THEN
    RAISE EXCEPTION 'specialty_module_cap_exceeded: max 10 active modules per specialty';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER specialty_module_cap_trigger
AFTER INSERT OR UPDATE ON "SpecialtyModule"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_specialty_module_cap();
