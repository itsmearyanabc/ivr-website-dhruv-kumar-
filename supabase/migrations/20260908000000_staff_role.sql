-- =========================================================================================
-- Staff accounts: operators who can run the panel, but cannot see who did what.
-- =========================================================================================
-- Additive and idempotent. Adds one enum value and widens the RLS predicate; changes no row,
-- drops nothing, and is safe to run twice or against a live database serving traffic.
--
-- Until this runs, the application probes for the value and simply offers no staff features -
-- the panel keeps working exactly as it does today. See hasStaffRole() in
-- src/lib/supabase/schema.ts.
--
-- The super admin is NOT a row in here. It stays the account matching the ADMIN_EMAIL
-- environment variable, exactly as before, so nothing in this migration can lock anyone out
-- of their own console. Staff are strictly additive.

-- -----------------------------------------------------------------------------------------
-- 1. The role
-- -----------------------------------------------------------------------------------------
-- ADD VALUE IF NOT EXISTS is idempotent, and unlike most ALTER TYPE forms it may run outside
-- a transaction block, which is what the Supabase SQL editor does.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'STAFF';

-- -----------------------------------------------------------------------------------------
-- 2. The admin predicate
-- -----------------------------------------------------------------------------------------
-- is_admin() gates every "admins can see everything" policy in the schema. Staff are meant to
-- run the panel, so they have to satisfy it too - otherwise a staff member signs in
-- successfully and then finds every list empty, which is exactly the silent-blank-screen
-- failure the service-role reads were introduced to avoid.
--
-- This deliberately does NOT distinguish staff from admin. Row visibility is the same for
-- both; the one thing staff cannot reach - the activity log - is withheld in the server
-- action, where it can be enforced rather than merely hidden. A staff member who called
-- getActivityLogs() straight from the browser would otherwise get the whole audit trail.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('ADMIN', 'STAFF')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------------------
-- 3. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'user_role' AND e.enumlabel = 'STAFF'
    )
    THEN 'OK - STAFF role available'
    ELSE 'MISSING - STAFF was not added to user_role'
  END AS staff_role;
