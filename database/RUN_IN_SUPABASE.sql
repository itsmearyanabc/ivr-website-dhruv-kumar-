-- =========================================================================================
-- XPACK — run this once in the Supabase SQL Editor
-- =========================================================================================
-- Project: dehwarnjivtnyqyeurvx
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run
--
-- Everything below is additive and idempotent: no table is dropped, no data is deleted, and
-- running it a second time is harmless.
--
-- A probe of the live database on 2026-08-03 found these three things missing, which is why
-- the admin customer directory showed an em dash in the Password column and why the Activity
-- log and Analytics chart were always empty:
--
--   * public.users.password_plain          (column)
--   * public.activity_logs                 (table)
--   * public.daily_statistics              (table)
--
-- Everything else the panel needs — broadcasts, wallet top-ups, categories/services,
-- transactions, the balance functions and the approve/reject RPCs — was already present and
-- is left untouched.
-- =========================================================================================


-- -----------------------------------------------------------------------------------------
-- 1. Admin-visible password on the customer profile
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_plain TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

-- The signup action already puts the password into auth metadata, so the profile trigger is
-- the right place to copy it across for every future signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, company_name, phone, password_plain, password_updated_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'company',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'password_plain',
    CASE WHEN new.raw_user_meta_data->>'password_plain' IS NULL THEN NULL ELSE NOW() END
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, public.users.full_name),
    company_name = COALESCE(EXCLUDED.company_name, public.users.company_name),
    phone        = COALESCE(EXCLUDED.phone, public.users.phone);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill accounts that already exist.
UPDATE public.users u
SET password_plain      = a.raw_user_meta_data->>'password_plain',
    password_updated_at = COALESCE(u.password_updated_at, a.created_at)
FROM auth.users a
WHERE a.id = u.id
  AND u.password_plain IS NULL
  AND a.raw_user_meta_data->>'password_plain' IS NOT NULL;


-- -----------------------------------------------------------------------------------------
-- 2. Activity log (audit trail behind Customers -> Activity log)
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_name TEXT,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_action_idx  ON public.activity_logs(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_user_idx    ON public.activity_logs(user_id, created_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admins can view all activity logs"
  ON public.activity_logs FOR SELECT USING (public.is_admin());
-- No INSERT policy on purpose: rows are only written by server actions holding the
-- service-role key, so a browser session cannot forge an audit entry.


-- -----------------------------------------------------------------------------------------
-- 3. Daily statistics (the Analytics chart)
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_statistics (
  id BIGSERIAL PRIMARY KEY,
  stat_date DATE NOT NULL UNIQUE,
  total_users INTEGER NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_payments NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_statistics_date_idx ON public.daily_statistics(stat_date DESC);

ALTER TABLE public.daily_statistics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view statistics" ON public.daily_statistics;
CREATE POLICY "Admins can view statistics"
  ON public.daily_statistics FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.update_daily_statistics()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    INSERT INTO public.daily_statistics (stat_date, total_users)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (stat_date) DO UPDATE SET
      total_users = public.daily_statistics.total_users + 1,
      updated_at = NOW();

  ELSIF TG_TABLE_NAME = 'broadcasts' THEN
    INSERT INTO public.daily_statistics (stat_date, total_orders)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (stat_date) DO UPDATE SET
      total_orders = public.daily_statistics.total_orders + 1,
      updated_at = NOW();

  ELSIF TG_TABLE_NAME = 'transactions' AND NEW.type = 'CREDIT' AND NEW.status = 'SUCCESS' THEN
    INSERT INTO public.daily_statistics (stat_date, total_payments, total_revenue)
    VALUES (CURRENT_DATE, 1, NEW.amount)
    ON CONFLICT (stat_date) DO UPDATE SET
      total_payments = public.daily_statistics.total_payments + 1,
      total_revenue  = public.daily_statistics.total_revenue + NEW.amount,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_stats_on_user ON public.users;
CREATE TRIGGER update_stats_on_user
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_daily_statistics();

DROP TRIGGER IF EXISTS update_stats_on_order ON public.broadcasts;
CREATE TRIGGER update_stats_on_order
  AFTER INSERT ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.update_daily_statistics();

DROP TRIGGER IF EXISTS update_stats_on_transaction ON public.transactions;
CREATE TRIGGER update_stats_on_transaction
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_daily_statistics();

-- Seed the chart from history that already exists, so Analytics is not blank on day one.
INSERT INTO public.daily_statistics (stat_date, total_users)
SELECT created_at::DATE, COUNT(*) FROM public.users GROUP BY created_at::DATE
ON CONFLICT (stat_date) DO UPDATE SET
  total_users = GREATEST(public.daily_statistics.total_users, EXCLUDED.total_users),
  updated_at = NOW();

INSERT INTO public.daily_statistics (stat_date, total_orders)
SELECT created_at::DATE, COUNT(*) FROM public.broadcasts GROUP BY created_at::DATE
ON CONFLICT (stat_date) DO UPDATE SET
  total_orders = GREATEST(public.daily_statistics.total_orders, EXCLUDED.total_orders),
  updated_at = NOW();

INSERT INTO public.daily_statistics (stat_date, total_payments, total_revenue)
SELECT created_at::DATE, COUNT(*), SUM(amount)
FROM public.transactions
WHERE type = 'CREDIT' AND status = 'SUCCESS'
GROUP BY created_at::DATE
ON CONFLICT (stat_date) DO UPDATE SET
  total_payments = GREATEST(public.daily_statistics.total_payments, EXCLUDED.total_payments),
  total_revenue  = GREATEST(public.daily_statistics.total_revenue, EXCLUDED.total_revenue),
  updated_at = NOW();


-- -----------------------------------------------------------------------------------------
-- 4. Verification — the result grid should show three rows, all reading 'OK'
-- -----------------------------------------------------------------------------------------
SELECT 'users.password_plain' AS item,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='users' AND column_name='password_plain'
       ) THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'activity_logs',
       CASE WHEN to_regclass('public.activity_logs') IS NULL THEN 'MISSING' ELSE 'OK' END
UNION ALL
SELECT 'daily_statistics',
       CASE WHEN to_regclass('public.daily_statistics') IS NULL THEN 'MISSING' ELSE 'OK' END;
