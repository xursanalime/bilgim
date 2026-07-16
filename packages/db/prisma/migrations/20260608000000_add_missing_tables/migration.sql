-- Add missing DmReadReceipt table and other schema updates

-- Add username column to User if not exists
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "location" TEXT;

-- Add unique constraint on username
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_username_key'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");
  END IF;
END $$;

-- Create DmReadReceipt table if not exists
CREATE TABLE IF NOT EXISTS "DmReadReceipt" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmReadReceipt_pkey" PRIMARY KEY ("roomId","userId")
);

-- Add foreign keys for DmReadReceipt
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DmReadReceipt_roomId_fkey'
  ) THEN
    ALTER TABLE "DmReadReceipt" ADD CONSTRAINT "DmReadReceipt_roomId_fkey" 
      FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DmReadReceipt_userId_fkey'
  ) THEN
    ALTER TABLE "DmReadReceipt" ADD CONSTRAINT "DmReadReceipt_userId_fkey" 
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Add joinCode to Group table
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;

-- Add unique constraint on Group.joinCode
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Group_joinCode_key'
  ) THEN
    ALTER TABLE "Group" ADD CONSTRAINT "Group_joinCode_key" UNIQUE ("joinCode");
  END IF;
END $$;

-- Add caption to Attachment table
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "caption" TEXT;

-- Add selectedOptionIds to OnboardingAnswer
ALTER TABLE "OnboardingAnswer" ADD COLUMN IF NOT EXISTS "selectedOptionIds" JSONB;

-- Add bio to StudentProfile
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "bio" TEXT;

-- Drop old indexes if they exist (task cleanup)
DROP INDEX IF EXISTS "Course_title_idx";
DROP INDEX IF EXISTS "Group_name_idx";
DROP INDEX IF EXISTS "TeacherProfile_fullName_idx";
DROP INDEX IF EXISTS "TeacherProfile_headline_idx";
