-- =========================================================================================
-- Indexes for the queries the panel actually runs.
-- =========================================================================================
-- Additive and idempotent: creates indexes only, changes no data, safe to run twice and safe
-- to run against the live database while it is serving traffic (see the CONCURRENTLY note at
-- the bottom if the tables have grown large).
--
-- Every index here backs a query that runs on a screen an operator or customer opens, and
-- none of them existed. On a small table Postgres will sequentially scan regardless and these
-- change nothing; they matter as the tables grow, which is exactly when the panel gets slow
-- and nobody remembers why.

-- -----------------------------------------------------------------------------------------
-- 1. The admin orders queue
-- -----------------------------------------------------------------------------------------
-- `getBroadcasts` orders every row by created_at DESC. For a customer that is served by
-- broadcasts_owner_status_idx, which leads with user_id - but the admin view has no user_id
-- filter at all, so that index cannot help it and the whole table is sorted on every load of
-- the busiest screen in the app.
CREATE INDEX IF NOT EXISTS broadcasts_created_idx
  ON public.broadcasts (created_at DESC);

-- -----------------------------------------------------------------------------------------
-- 2. Support
-- -----------------------------------------------------------------------------------------
-- A customer's ticket list filters on user_id; nothing indexed it.
CREATE INDEX IF NOT EXISTS support_tickets_user_idx
  ON public.support_tickets (user_id, created_at DESC);

-- `getTickets` joins every ticket to its messages, and deleting a ticket cascades to them.
-- Neither had an index to work from.
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
  ON public.support_messages (ticket_id, created_at ASC);

-- Deleting a customer cascades through their messages. Without this the cascade is a
-- sequential scan of the whole table per row removed.
CREATE INDEX IF NOT EXISTS support_messages_sender_idx
  ON public.support_messages (sender_id);

-- -----------------------------------------------------------------------------------------
-- 3. The service catalogue
-- -----------------------------------------------------------------------------------------
-- Read on every visit to the New broadcast screen, and again server-side whenever an order is
-- priced. categories -> services is the join, and services.category_id was unindexed despite
-- being a foreign key that also cascades on delete.
CREATE INDEX IF NOT EXISTS services_category_idx
  ON public.services (category_id);

-- -----------------------------------------------------------------------------------------
-- 4. Report
-- -----------------------------------------------------------------------------------------
SELECT
  i.item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = i.item
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('broadcasts_created_idx'),
  ('support_tickets_user_idx'),
  ('support_messages_ticket_idx'),
  ('support_messages_sender_idx'),
  ('services_category_idx')
) AS i(item);

-- -----------------------------------------------------------------------------------------
-- If a table is already large enough that building an index blocks writes for longer than you
-- want, run each statement outside a transaction as:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS <name> ON <table> (<columns>);
--
-- CONCURRENTLY cannot run inside a transaction block, so it cannot be used in this file - the
-- Supabase SQL editor wraps a script in one. Paste those variants in individually instead.
-- -----------------------------------------------------------------------------------------
