-- Supabase Schema for Xpack IVR Broadcast Management
-- Run this script in your Supabase SQL Editor

-- 1. Custom Types
CREATE TYPE public.user_role AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE public.broadcast_status AS ENUM ('PLACED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE public.ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE public.ticket_priority AS ENUM ('NORMAL', 'HIGH');

-- 2. Tables
-- Users table syncs with auth.users
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'CUSTOMER',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reference_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  audio_key TEXT NOT NULL,
  contacts_key TEXT NOT NULL,
  contact_count INTEGER,
  scheduled_for TIMESTAMPTZ,
  status broadcast_status NOT NULL DEFAULT 'PLACED',
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

-- 3. Automatic User Profile Creation via Trigger
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

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Users can only see their own profile
CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT USING (auth.uid() = id);
-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON public.users FOR SELECT USING (public.is_admin());

-- Broadcasts: Customers see their own, Admins see all
CREATE POLICY "Customers view own broadcasts" ON public.broadcasts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Customers insert own broadcasts" ON public.broadcasts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all broadcasts" ON public.broadcasts FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins update all broadcasts" ON public.broadcasts FOR UPDATE USING (public.is_admin());

-- Tickets: Customers see their own, Admins see all
CREATE POLICY "Customers view own tickets" ON public.support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Customers insert own tickets" ON public.support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all tickets" ON public.support_tickets FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins update all tickets" ON public.support_tickets FOR UPDATE USING (public.is_admin());

-- Messages: Can view if they have access to the parent ticket
CREATE POLICY "View messages for accessible tickets" ON public.support_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.support_tickets WHERE id = support_messages.ticket_id)
);
CREATE POLICY "Insert messages for accessible tickets" ON public.support_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.support_tickets WHERE id = ticket_id) AND sender_id = auth.uid()
);

-- 6. Storage Buckets Setup
-- You will need to manually create 1 bucket in Supabase Storage: 'xpack_files' (Make sure to set it to PRIVATE)
-- After creating it, the backend will interact with it automatically.
