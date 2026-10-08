-- ============================================================================
--  NEXUS JEE — Supabase schema
--  Kahan chalana hai : Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--  Dobara chalane par bhi safe hai (idempotent) — IF NOT EXISTS + POLICY drop/create.
--
--  TABLES : profiles, tasks, sessions, syllabus_progress, mistakes, lectures, tests
--  RLS    : har table par Row Level Security ON. Policy ek hi hai har table ke liye:
--             auth.uid() = user_id   (profiles me auth.uid() = id)
--           Matlab logged-in user sirf apni rows select/insert/update/delete kar sakta
--           hai. anon (bina login) ko kuch bhi nahi dikhta.
--
--  ID KAISE KAM KARTA HAI
--    App ke local ids text hote hain ('t1a2b3c', 's1712345678901', ...), uuid nahi.
--    Isliye id = text aur primary key composite (user_id, id) rakhi hai — do users ke
--    same-sa id ho jaayein to bhi takkar nahi hogi. JS `upsert(..., onConflict:
--    'user_id,id')` isi PK par chalta hai.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Common timestamp trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) PROFILES — auth.users ka public extension (naam, avatar, xp, exam date)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text,
  avatar_url text,
  xp         integer     NOT NULL DEFAULT 0,
  exam_date  text,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_own" ON public.profiles;
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Naya user signup (Google login) -> profile row automatically ban jaaye.
-- SECURITY DEFINER chahiye kyunki auth.users par insert trigger se profiles
-- me likhna hai jabki us waqt koi session nahi hota.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, avatar_url, xp, exam_date)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    0,
    '2027-01-22'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2) TASKS — planner / calendar / dashboard
--    local shape: {id,title,subject,date,block,duration,priority,repeat,done,doneAt,dones}
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id         text        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT '',
  subject    text        NOT NULL DEFAULT 'General',
  date       text        NOT NULL,
  block      text        NOT NULL DEFAULT 'morning',
  duration   integer     NOT NULL DEFAULT 30,
  priority   integer     NOT NULL DEFAULT 2,
  "repeat"   text        NOT NULL DEFAULT 'none',
  done       boolean     NOT NULL DEFAULT false,
  done_at    bigint,                      -- epoch ms (local shape ke saath lossless)
  dones      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { '2026-10-07': true }
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_own" ON public.tasks;
CREATE POLICY "tasks_own" ON public.tasks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_tasks_updated ON public.tasks;
CREATE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) SESSIONS — focus timer ke logged sessions
--    local shape: {date, minutes, at}   (koi apna id nahi -> id = 's' || at)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
  id         text        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text        NOT NULL,
  minutes    integer     NOT NULL DEFAULT 0,
  at         bigint      NOT NULL,        -- epoch ms
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_own" ON public.sessions;
CREATE POLICY "sessions_own" ON public.sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_sessions_updated ON public.sessions;
CREATE TRIGGER trg_sessions_updated
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) SYLLABUS_PROGRESS — har chapter ke 4 topic toggles
--    local shape: { 'ch-phy-01': [[1,0,1,0],[0,0,0,0], ...] }
--    id = chapter_id, topic_states = us chapter ka array
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.syllabus_progress (
  id           text        NOT NULL,      -- chapter_id
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_states jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.syllabus_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "syllabus_progress_own" ON public.syllabus_progress;
CREATE POLICY "syllabus_progress_own" ON public.syllabus_progress
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_syllabus_updated ON public.syllabus_progress;
CREATE TRIGGER trg_syllabus_updated
  BEFORE UPDATE ON public.syllabus_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) MISTAKES — mistake book (spaced revision)
--    local shape: {id,title,subject,chapter,reason,notes,photoRef,created,at,
--                  stage,nextReview,mastered,history}
--    NOTE: base64 `photo` sync nahi hoti (bahut badi hoti hai) — sirf photo_ref.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mistakes (
  id          text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT '',
  subject     text        NOT NULL DEFAULT 'General',
  chapter     text,
  reason      text        NOT NULL DEFAULT 'concept',
  notes       text,
  photo_ref   text,
  created     text        NOT NULL,
  at          bigint      NOT NULL,       -- epoch ms
  stage       integer     NOT NULL DEFAULT 0,
  next_review text,
  mastered    boolean     NOT NULL DEFAULT false,
  history     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mistakes_own" ON public.mistakes;
CREATE POLICY "mistakes_own" ON public.mistakes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_mistakes_updated ON public.mistakes;
CREATE TRIGGER trg_mistakes_updated
  BEFORE UPDATE ON public.mistakes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) LECTURES — lecture tracker (page abhi stub hai, table ready rakhi hai)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lectures (
  id         text        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT '',
  subject    text        NOT NULL DEFAULT 'General',
  chapter    text,
  status     text        NOT NULL DEFAULT 'pending',   -- pending | watching | done
  url        text,
  duration   integer,                                   -- minutes
  watched_at bigint,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectures_own" ON public.lectures;
CREATE POLICY "lectures_own" ON public.lectures
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_lectures_updated ON public.lectures;
CREATE TRIGGER trg_lectures_updated
  BEFORE UPDATE ON public.lectures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) TESTS — mock test results
--    local shape: {id,name,date,pm,pq,cm,cq,mm,mq,minutes,rank,at}
--    pm/cm/mm = marks, pq/cq/mq = questions attempted (subject-wise)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tests (
  id         text        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '',
  date       text        NOT NULL,
  pm         integer     NOT NULL DEFAULT 0,
  pq         integer     NOT NULL DEFAULT 0,
  cm         integer     NOT NULL DEFAULT 0,
  cq         integer     NOT NULL DEFAULT 0,
  mm         integer     NOT NULL DEFAULT 0,
  mq         integer     NOT NULL DEFAULT 0,
  minutes    integer     NOT NULL DEFAULT 0,
  "rank"     integer,
  at         bigint      NOT NULL,        -- epoch ms
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tests_own" ON public.tests;
CREATE POLICY "tests_own" ON public.tests
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_tests_updated ON public.tests;
CREATE TRIGGER trg_tests_updated
  BEFORE UPDATE ON public.tests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Indexes (RLS ke saath user_id filter har query me lagta hai)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_user      ON public.tasks(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON public.sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_mistakes_user   ON public.mistakes(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_tests_user      ON public.tests(user_id, date);
CREATE INDEX IF NOT EXISTS idx_lectures_user   ON public.lectures(user_id, status);
CREATE INDEX IF NOT EXISTS idx_syllabus_user   ON public.syllabus_progress(user_id);

-- ---------------------------------------------------------------------------
-- 9) Grants — sirf logged-in role ko table access. RLS uske upar lagta hai.
--    anon ko jaan-boojh kar kuch nahi diya, isliye bina login kuch bhi nahi milta.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- ============================================================================
--  VERIFY (optional) — ye chalane par har table par RLS ON dikhna chahiye:
--
--    SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname = 'public' ORDER BY tablename;
--
--    SELECT tablename, policyname, cmd, qual FROM pg_policies
--     WHERE schemaname = 'public' ORDER BY tablename;
--
--  Aur policies yahan dikhengi:
--    Supabase Dashboard -> Authentication -> Policies
-- ============================================================================
