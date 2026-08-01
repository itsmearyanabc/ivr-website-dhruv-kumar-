-- =========================================================================================
-- Migration: Add password storage for admin visibility and statistics tracking
-- =========================================================================================
-- This migration adds:
-- 1. Password field to users table (for admin visibility)
-- 2. Statistics tracking table for orders, users, and payments
-- 3. Indexes for performance

-- Add password field to users table (stored as plain text for admin visibility)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_plain TEXT;

-- Create statistics tracking table
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

-- Create index for fast date lookups
CREATE INDEX IF NOT EXISTS daily_statistics_date_idx ON public.daily_statistics(stat_date DESC);

-- Create activity log table for proper audit trail
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_name TEXT,
  action_type TEXT NOT NULL, -- 'ORDER_CREATED', 'PAYMENT_APPROVED', 'USER_REGISTERED', etc.
  entity_type TEXT, -- 'ORDER', 'PAYMENT', 'USER', 'TICKET', etc.
  entity_id TEXT,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for activity logs
CREATE INDEX IF NOT EXISTS activity_logs_user_idx ON public.activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_action_idx ON public.activity_logs(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON public.activity_logs(created_at DESC);

-- Enable RLS on new tables
ALTER TABLE public.daily_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_statistics (admin only)
CREATE POLICY "Admins can view statistics" ON public.daily_statistics
  FOR SELECT USING (public.is_admin());

-- RLS Policies for activity_logs (admin only)
CREATE POLICY "Admins can view all activity logs" ON public.activity_logs
  FOR SELECT USING (public.is_admin());

-- Function to log activity
CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID,
  p_user_email TEXT,
  p_user_name TEXT,
  p_action_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}',
  p_ip_address TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  v_log_id BIGINT;
BEGIN
  INSERT INTO public.activity_logs (
    user_id, user_email, user_name, action_type, entity_type, entity_id,
    description, metadata, ip_address
  ) VALUES (
    p_user_id, p_user_email, p_user_name, p_action_type, p_entity_type, p_entity_id,
    p_description, p_metadata, p_ip_address
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update daily statistics
CREATE OR REPLACE FUNCTION public.update_daily_statistics()
RETURNS TRIGGER AS $$
BEGIN
  -- Update statistics based on the trigger source
  IF TG_TABLE_NAME = 'users' THEN
    INSERT INTO public.daily_statistics (stat_date, total_users)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (stat_date) 
    DO UPDATE SET 
      total_users = daily_statistics.total_users + 1,
      updated_at = NOW();
  ELSIF TG_TABLE_NAME = 'broadcasts' THEN
    INSERT INTO public.daily_statistics (stat_date, total_orders)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (stat_date) 
    DO UPDATE SET 
      total_orders = daily_statistics.total_orders + 1,
      updated_at = NOW();
  ELSIF TG_TABLE_NAME = 'transactions' AND NEW.type = 'CREDIT' AND NEW.status = 'SUCCESS' THEN
    INSERT INTO public.daily_statistics (stat_date, total_payments, total_revenue)
    VALUES (CURRENT_DATE, 1, NEW.amount)
    ON CONFLICT (stat_date) 
    DO UPDATE SET 
      total_payments = daily_statistics.total_payments + 1,
      total_revenue = daily_statistics.total_revenue + NEW.amount,
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for automatic statistics updates
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

-- Grant necessary permissions
GRANT SELECT ON public.daily_statistics TO authenticated;
GRANT SELECT ON public.activity_logs TO authenticated;
