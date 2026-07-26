-- Migration: Atomic balance operations and missing enum values

-- 1. Add missing broadcast_status enum values if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'broadcast_status' AND e.enumlabel = 'PARTIAL') THEN
    ALTER TYPE public.broadcast_status ADD VALUE 'PARTIAL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'broadcast_status' AND e.enumlabel = 'ON_HOLD') THEN
    ALTER TYPE public.broadcast_status ADD VALUE 'ON_HOLD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'broadcast_status' AND e.enumlabel = 'REFUNDED') THEN
    ALTER TYPE public.broadcast_status ADD VALUE 'REFUNDED';
  END IF;
END
$$;

-- 2. Ensure balance column exists on users table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'balance') THEN
    ALTER TABLE public.users ADD COLUMN balance NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;
END
$$;

-- 3. Create or replace the increment_balance function (atomic credit)
CREATE OR REPLACE FUNCTION public.increment_balance(uid UUID, amt NUMERIC)
RETURNS TABLE(success BOOLEAN, new_balance NUMERIC) AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.users SET balance = balance + amt WHERE id = uid RETURNING balance INTO v_new_balance;
  IF v_new_balance IS NULL THEN
    RETURN QUERY SELECT false, 0::NUMERIC;
  ELSE
    RETURN QUERY SELECT true, v_new_balance;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create safe_deduct_balance function (atomic check-and-deduct)
-- Prevents race conditions by checking balance >= amount in the same UPDATE
CREATE OR REPLACE FUNCTION public.safe_deduct_balance(uid UUID, amt NUMERIC)
RETURNS TABLE(success BOOLEAN, new_balance NUMERIC) AS $$
DECLARE
  v_result RECORD;
BEGIN
  UPDATE public.users SET balance = balance - amt
  WHERE id = uid AND balance >= amt
  RETURNING true AS success, balance AS new_balance INTO v_result;

  IF v_result IS NULL THEN
    SELECT false, balance INTO v_result FROM public.users WHERE id = uid;
    IF v_result IS NULL THEN
      RETURN QUERY SELECT false, 0::NUMERIC;
    ELSE
      RETURN QUERY SELECT false, v_result.balance;
    END IF;
  ELSE
    RETURN QUERY SELECT v_result.success, v_result.new_balance;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Ensure transactions table exists
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_order_idx ON public.transactions(order_id);

-- 6. Ensure broadcast_status_history table exists
CREATE TABLE IF NOT EXISTS public.broadcast_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS broadcast_history_idx ON public.broadcast_status_history(broadcast_id, created_at DESC);

-- 7. Ensure categories table exists
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Ensure services table exists
CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_quantity INTEGER,
  max_quantity INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Ensure system_settings table exists
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Add missing columns to broadcasts table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='category_id') THEN
    ALTER TABLE public.broadcasts ADD COLUMN category_id UUID REFERENCES public.categories(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='service_id') THEN
    ALTER TABLE public.broadcasts ADD COLUMN service_id UUID REFERENCES public.services(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='category_name') THEN
    ALTER TABLE public.broadcasts ADD COLUMN category_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='service_name') THEN
    ALTER TABLE public.broadcasts ADD COLUMN service_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='voice_type') THEN
    ALTER TABLE public.broadcasts ADD COLUMN voice_type TEXT DEFAULT 'MALE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='contacts_input_type') THEN
    ALTER TABLE public.broadcasts ADD COLUMN contacts_input_type TEXT DEFAULT 'FILE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='manual_contacts') THEN
    ALTER TABLE public.broadcasts ADD COLUMN manual_contacts TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='charge') THEN
    ALTER TABLE public.broadcasts ADD COLUMN charge NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='hold_reason') THEN
    ALTER TABLE public.broadcasts ADD COLUMN hold_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='cancel_reason') THEN
    ALTER TABLE public.broadcasts ADD COLUMN cancel_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='refund_reason') THEN
    ALTER TABLE public.broadcasts ADD COLUMN refund_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='admin_comment') THEN
    ALTER TABLE public.broadcasts ADD COLUMN admin_comment TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='broadcasts' AND column_name='partial_refund_amount') THEN
    ALTER TABLE public.broadcasts ADD COLUMN partial_refund_amount NUMERIC(12,2);
  END IF;
  ALTER TABLE public.broadcasts ALTER COLUMN contacts_key DROP NOT NULL;
END
$$;

-- 11. RLS for new tables
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Customers view own transactions') THEN
    CREATE POLICY "Customers view own transactions" ON public.transactions FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Admins view all transactions') THEN
    CREATE POLICY "Admins view all transactions" ON public.transactions FOR SELECT USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'broadcast_status_history' AND policyname = 'View history for accessible broadcasts') THEN
    CREATE POLICY "View history for accessible broadcasts" ON public.broadcast_status_history FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.broadcasts WHERE id = broadcast_status_history.broadcast_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Anyone view active categories') THEN
    CREATE POLICY "Anyone view active categories" ON public.categories FOR SELECT USING (is_active = true OR public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Admins manage categories') THEN
    CREATE POLICY "Admins manage categories" ON public.categories FOR ALL USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'Anyone view active services') THEN
    CREATE POLICY "Anyone view active services" ON public.services FOR SELECT USING (is_active = true OR public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'Admins manage services') THEN
    CREATE POLICY "Admins manage services" ON public.services FOR ALL USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'system_settings' AND policyname = 'Admins view settings') THEN
    CREATE POLICY "Admins view settings" ON public.system_settings FOR SELECT USING (public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'system_settings' AND policyname = 'Admins manage settings') THEN
    CREATE POLICY "Admins manage settings" ON public.system_settings FOR ALL USING (public.is_admin());
  END IF;
END
$$;

-- 12. Grant execute on new functions
GRANT EXECUTE ON FUNCTION public.safe_deduct_balance(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_balance(UUID, NUMERIC) TO authenticated;