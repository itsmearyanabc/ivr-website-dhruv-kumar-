-- =========================================================================================
-- XPACK MASTER DATABASE SETUP SCRIPT
-- =========================================================================================
-- Run this entire script ONCE in your Supabase SQL Editor.
-- It will safely clean up old conflicting tables and set up the perfect structure.

-- 1. CLEANUP OLD CONFLICTING STRUCTURES
DROP TABLE IF EXISTS public.system_settings CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.broadcast_status_history CASCADE;
DROP TABLE IF EXISTS public.support_messages CASCADE;
DROP TABLE IF EXISTS public.support_tickets CASCADE;
DROP TABLE IF EXISTS public.reports CASCADE;
DROP TABLE IF EXISTS public.broadcasts CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP TYPE IF EXISTS public.user_role CASCADE;
DROP TYPE IF EXISTS public.broadcast_status CASCADE;
DROP TYPE IF EXISTS public.ticket_status CASCADE;
DROP TYPE IF EXISTS public.ticket_priority CASCADE;
DROP TYPE IF EXISTS public.transaction_type CASCADE;

-- 2. CREATE NEW CUSTOM TYPES
CREATE TYPE public.user_role AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE public.broadcast_status AS ENUM ('PLACED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'ON_HOLD', 'REFUNDED');
CREATE TYPE public.ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE public.ticket_priority AS ENUM ('NORMAL', 'HIGH');
CREATE TYPE public.transaction_type AS ENUM ('CREDIT', 'DEBIT');

-- 3. CREATE TABLES
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  min_quantity INTEGER DEFAULT 1,
  max_quantity INTEGER DEFAULT 100000,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'CUSTOMER',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reference_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  category_name TEXT,
  service_name TEXT,
  voice_type TEXT DEFAULT 'MALE', 
  description TEXT,
  audio_key TEXT NOT NULL,
  contacts_input_type TEXT DEFAULT 'FILE',
  contacts_key TEXT,
  manual_contacts TEXT,
  contact_count INTEGER,
  charge NUMERIC(12,2) DEFAULT 0.00,
  scheduled_for TIMESTAMPTZ,
  status broadcast_status NOT NULL DEFAULT 'PLACED',
  hold_reason TEXT,
  cancel_reason TEXT,
  refund_reason TEXT,
  refund_amount NUMERIC(12,2),
  partial_refund_amount NUMERIC(12,2),
  admin_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX broadcasts_owner_status_idx ON public.broadcasts(user_id, status, created_at DESC);

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID UNIQUE NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  customer_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reference_no TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  priority ticket_priority NOT NULL DEFAULT 'NORMAL',
  status ticket_status NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment_key TEXT,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.broadcast_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX bsh_broadcast_idx ON public.broadcast_status_history(broadcast_id, created_at);

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  type transaction_type NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX transactions_user_idx ON public.transactions(user_id, created_at DESC);

CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 4. UTILITY FUNCTIONS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, company_name, phone)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'company',
    new.raw_user_meta_data->>'phone'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

GRANT EXECUTE ON FUNCTION public.safe_deduct_balance(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_balance(UUID, NUMERIC) TO authenticated;


-- 5. ENABLE ROW LEVEL SECURITY & POLICIES
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Admins can manage categories" ON public.categories FOR ALL USING (public.is_admin());

CREATE POLICY "Anyone can view active services" ON public.services FOR SELECT USING (true);
CREATE POLICY "Admins can manage services" ON public.services FOR ALL USING (public.is_admin());

CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.users FOR SELECT USING (public.is_admin());

CREATE POLICY "Customers view own broadcasts" ON public.broadcasts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Customers insert own broadcasts" ON public.broadcasts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all broadcasts" ON public.broadcasts FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins update all broadcasts" ON public.broadcasts FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins view all status history" ON public.broadcast_status_history FOR SELECT USING (public.is_admin());
CREATE POLICY "View own broadcast status history" ON public.broadcast_status_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.broadcasts WHERE id = broadcast_status_history.broadcast_id AND user_id = auth.uid())
);

CREATE POLICY "Customers view own tickets" ON public.support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Customers insert own tickets" ON public.support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all tickets" ON public.support_tickets FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins update all tickets" ON public.support_tickets FOR UPDATE USING (public.is_admin());

CREATE POLICY "View messages for accessible tickets" ON public.support_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.support_tickets WHERE id = support_messages.ticket_id)
);
CREATE POLICY "Insert messages for accessible tickets" ON public.support_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.support_tickets WHERE id = ticket_id) AND sender_id = auth.uid()
);

CREATE POLICY "Customers view own transactions" ON public.transactions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins view all transactions" ON public.transactions FOR SELECT USING (public.is_admin());

CREATE POLICY "Anyone can view settings" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings" ON public.system_settings FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can insert settings" ON public.system_settings FOR INSERT WITH CHECK (public.is_admin());

-- 6. RE-SYNC ALL EXISTING USERS INTO THE NEW TABLE
-- This guarantees that if you drop the users table, all authenticated users are restored correctly.
INSERT INTO public.users (id, email, full_name, company_name, phone)
SELECT 
  id, 
  email, 
  COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1)), 
  raw_user_meta_data->>'company', 
  raw_user_meta_data->>'phone'
FROM auth.users
ON CONFLICT (id) DO NOTHING;
