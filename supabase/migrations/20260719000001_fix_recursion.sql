-- Fix infinite recursion in RLS policies by using a security definer function

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate policies on public.users
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
CREATE POLICY "Admins can view all profiles" ON public.users 
  FOR SELECT USING (public.is_admin());

-- Recreate policies on public.broadcasts
DROP POLICY IF EXISTS "Admins view all broadcasts" ON public.broadcasts;
CREATE POLICY "Admins view all broadcasts" ON public.broadcasts 
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins update all broadcasts" ON public.broadcasts;
CREATE POLICY "Admins update all broadcasts" ON public.broadcasts 
  FOR UPDATE USING (public.is_admin());

-- Recreate policies on public.support_tickets
DROP POLICY IF EXISTS "Admins view all tickets" ON public.support_tickets;
CREATE POLICY "Admins view all tickets" ON public.support_tickets 
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins update all tickets" ON public.support_tickets;
CREATE POLICY "Admins update all tickets" ON public.support_tickets 
  FOR UPDATE USING (public.is_admin());
