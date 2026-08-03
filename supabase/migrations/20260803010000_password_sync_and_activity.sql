-- =========================================================================================
-- Migration: make the admin-visible password a real column, and make the activity log usable
-- =========================================================================================
-- Additive and idempotent. Safe to run repeatedly against the live database.
--
-- Background: the previous migration added public.users.password_plain but nothing ever
-- wrote to it, so the admin customer directory always rendered an em dash and the
-- "Login as user" flow could never take the fast password path. The signup action puts the
-- password into auth.users.raw_user_meta_data, so the profile trigger is the right place to
-- copy it across, plus a one-off backfill for accounts created before this migration.

-- -----------------------------------------------------------------------------------------
-- 1. Column + index
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_plain TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------------------
-- 2. Profile trigger now carries the password across from auth metadata
-- -----------------------------------------------------------------------------------------
-- ON CONFLICT keeps signup working if a profile row somehow already exists (for example an
-- admin account created directly in the Supabase dashboard and then signed up again).
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

-- -----------------------------------------------------------------------------------------
-- 3. Backfill existing accounts from auth metadata
-- -----------------------------------------------------------------------------------------
UPDATE public.users u
SET password_plain      = a.raw_user_meta_data->>'password_plain',
    password_updated_at = COALESCE(u.password_updated_at, a.created_at)
FROM auth.users a
WHERE a.id = u.id
  AND u.password_plain IS NULL
  AND a.raw_user_meta_data->>'password_plain' IS NOT NULL;

-- -----------------------------------------------------------------------------------------
-- 4. Activity log: allow the service role to write, keep reads admin-only
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

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_action_idx ON public.activity_logs(action_type, created_at DESC);

DROP POLICY IF EXISTS "Admins can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admins can view all activity logs"
  ON public.activity_logs FOR SELECT USING (public.is_admin());
-- No INSERT policy on purpose: entries are only ever written by server actions holding the
-- service-role key, so a browser session cannot forge an audit trail entry.

-- -----------------------------------------------------------------------------------------
-- 5. Daily statistics: correct the payment counter and make backfill possible
-- -----------------------------------------------------------------------------------------
-- total_payments was declared NUMERIC but is a count, and the previous trigger fired for
-- every transaction row including the DEBIT side. Recreate it so the chart reflects reality.
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
      total_revenue = public.daily_statistics.total_revenue + NEW.amount,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill the chart from data that already exists, so Analytics is not blank on day one.
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
  total_revenue = GREATEST(public.daily_statistics.total_revenue, EXCLUDED.total_revenue),
  updated_at = NOW();
