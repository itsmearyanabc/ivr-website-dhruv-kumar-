-- =========================================================================================
-- Allow GENERIC_UPI as a top-up verification mode.
-- =========================================================================================
-- payment_methods.verification_mode is guarded by a CHECK constraint that was written when
-- MANUAL and DECENTRO were the only two modes:
--
--   CONSTRAINT payment_methods_mode CHECK (verification_mode IN ('MANUAL', 'DECENTRO'))
--
-- The BharatPe / generic UPI gateway adds a third. Without this migration the console offers
-- the mode and the server action accepts it, and then the database rejects the write with a
-- check-constraint violation - so the mode looks selectable and can never actually be saved.
--
-- Additive and idempotent: it drops the constraint by name if present and recreates it with
-- the wider set, which lands correctly whether the database still has the original two-value
-- constraint, already has this one, or somehow has neither. It changes no row, and every mode
-- that was valid before is still valid.

-- -----------------------------------------------------------------------------------------
-- 1. Widen the constraint
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_mode;

ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_mode
  CHECK (verification_mode IN ('MANUAL', 'DECENTRO', 'GENERIC_UPI'));

COMMENT ON COLUMN public.payment_methods.verification_mode IS
  'How a submitted UTR is checked: MANUAL (an operator looks), DECENTRO (bank statement API), '
  'or GENERIC_UPI (external UPI gateway). The non-manual modes also require their own '
  'credentials in the server environment - see getVerifier() in src/lib/payments/utr.ts.';

-- -----------------------------------------------------------------------------------------
-- 2. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN pg_get_constraintdef(oid) LIKE '%GENERIC_UPI%'
    THEN 'OK - GENERIC_UPI accepted by payment_methods_mode'
    ELSE 'MISSING - constraint still refuses GENERIC_UPI'
  END AS verification_mode_constraint
FROM pg_constraint
WHERE conname = 'payment_methods_mode'
  AND conrelid = 'public.payment_methods'::regclass;
