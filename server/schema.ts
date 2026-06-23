// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL schema — auto-applied on server start (idempotent CREATE IF NOT EXISTS)
//
// Design notes:
//  • Lessons are normalized into their own table (was nested inside the course
//    document in Firestore → caused the 1 MB document-size limit). ai_knowledge
//    is TEXT, so AI transcripts of any length are fine.
//  • assigned_to_users / file_urls / test_config / chat_history are JSONB —
//    flexible, queryable, no size limit that matters here.
//  • results / progress use composite PK (user_id, course_id) — matches the old
//    deterministic doc id `${userId}_${courseId}`.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN DEFAULT FALSE,
  hidden_from_users BOOLEAN DEFAULT FALSE,
  type TEXT,
  file_url TEXT,
  has_simulator BOOLEAN,
  simulator_mode TEXT,
  simulator_turns INTEGER,
  test_mode TEXT,
  test_config JSONB DEFAULT '{"type":"none","questions":[]}'::jsonb,
  assigned_to_users JSONB DEFAULT '[]'::jsonb,
  assigned_to_departments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  file_urls JSONB DEFAULT '[]'::jsonb,
  ai_knowledge TEXT,
  test_config JSONB,
  PRIMARY KEY (course_id, id)
);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);

-- Migrate older installs where lessons PK was (id) alone (globally unique).
-- Lessons are scoped to a course, so the correct key is (course_id, id);
-- a global id PK breaks when lesson ids repeat across courses.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'lessons' AND c.contype = 'p'
      AND array_length(c.conkey, 1) = 1
  ) THEN
    ALTER TABLE lessons DROP CONSTRAINT lessons_pkey;
    DELETE FROM lessons a USING lessons b
      WHERE a.ctid < b.ctid AND a.course_id = b.course_id AND a.id = b.id;
    ALTER TABLE lessons ADD CONSTRAINT lessons_pkey PRIMARY KEY (course_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  position TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'employee',
  avatar TEXT,
  department TEXT,
  email TEXT,
  bitrix_id TEXT,
  assigned_courses JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'employee'
);

CREATE TABLE IF NOT EXISTS results (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  progress INTEGER DEFAULT 0,
  tutor_rating INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT DEFAULT 'in-progress',
  lessons JSONB DEFAULT '[]'::jsonb,
  overall_progress INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  text TEXT DEFAULT '',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS simulator_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT,
  lesson_id TEXT,
  score INTEGER DEFAULT 0,
  feedback TEXT,
  chat_history JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_user ON simulator_sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB
);

-- Question banks (Moodle XML import). A test can pull N random questions from a bank.
CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  course_id TEXT,
  questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SCORM packages (unzipped to S3 under s3_prefix; launch_href is relative to it).
CREATE TABLE IF NOT EXISTS scorm_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.2',  -- '1.2' | '2004'
  launch_href TEXT NOT NULL DEFAULT 'index.html',
  s3_prefix TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Per-user SCORM runtime state (CMI data model — status, score, suspend_data…).
CREATE TABLE IF NOT EXISTS scorm_runtime (
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  cmi JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, package_id)
);

-- Link a lesson to a SCORM package (lesson plays the package instead of media).
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS scorm_package_id TEXT;
-- Link a whole course to a SCORM package (course media is the package).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS scorm_package_id TEXT;
`;
