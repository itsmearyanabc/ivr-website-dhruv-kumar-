-- =========================================================================================
-- Announcements: a message the operator writes once, that every customer sees.
-- =========================================================================================
-- Additive and idempotent. Creates two tables and touches nothing that already exists, so it
-- is safe to run twice or against a live database serving traffic.
--
-- Until this runs the application probes for the tables and simply offers no announcements -
-- the panel keeps working exactly as it does today. See hasAnnouncementsTable() in
-- src/lib/supabase/schema.ts.
--
-- WHY TWO TABLES, rather than one row per customer per message:
-- fanning a message out at send time would miss every customer who signs up afterwards, and
-- would need a write per customer for each message. An announcement is therefore stored once,
-- and "has this person read it" is a receipt written the first time they open it. Read state
-- is per customer; the message itself is shared.

-- -----------------------------------------------------------------------------------------
-- 1. The message
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  -- Who wrote it. Kept as a name as well as an id because staff accounts can be deleted and
  -- the message should still say who sent it - the same reason activity_logs carries a name.
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  -- Withdrawn rather than deleted: unpublishing hides it from every customer while keeping
  -- the read receipts intact, so re-publishing does not make it unread again for people who
  -- had already seen it.
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.announcements IS
  'Operator messages shown to every customer. Read state lives in announcement_reads.';

-- The customer's list is "active messages, newest first", which is this index exactly.
CREATE INDEX IF NOT EXISTS idx_announcements_active_created
  ON public.announcements (is_active, created_at DESC);

-- -----------------------------------------------------------------------------------------
-- 2. The receipt
-- -----------------------------------------------------------------------------------------
-- One row the first time a customer opens a message. No row means unread, which is what makes
-- the badge blink. The composite primary key makes a second read a no-op on conflict rather
-- than a duplicate, so marking read is safe to call on every visit to the panel.
CREATE TABLE IF NOT EXISTS public.announcement_reads (
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

COMMENT ON TABLE public.announcement_reads IS
  'One row per customer per announcement they have opened. Absence of a row means unread.';

-- "What has this customer not read yet", the query behind the blinking badge on every load.
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON public.announcement_reads (user_id, announcement_id);

-- -----------------------------------------------------------------------------------------
-- 3. Row level security
-- -----------------------------------------------------------------------------------------
-- The application reads and writes both tables through service-role server actions that check
-- the caller themselves, exactly as the rest of the admin surface does. These policies are the
-- backstop for anything reaching the tables with a customer's own key.
ALTER TABLE public.announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements readable by signed-in users" ON public.announcements;
CREATE POLICY "announcements readable by signed-in users"
  ON public.announcements FOR SELECT
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS "announcements writable by admins" ON public.announcements;
CREATE POLICY "announcements writable by admins"
  ON public.announcements FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- A customer may only ever see, or create, a receipt in their own name - otherwise one
-- account could mark a message read for another, or read off who has seen what.
DROP POLICY IF EXISTS "own read receipts" ON public.announcement_reads;
CREATE POLICY "own read receipts"
  ON public.announcement_reads FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "record own read receipt" ON public.announcement_reads;
CREATE POLICY "record own read receipt"
  ON public.announcement_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------------------
-- 4. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'announcements')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'announcement_reads')
    THEN 'OK - announcements and announcement_reads present'
    ELSE 'MISSING - one or both announcement tables were not created'
  END AS announcements;
