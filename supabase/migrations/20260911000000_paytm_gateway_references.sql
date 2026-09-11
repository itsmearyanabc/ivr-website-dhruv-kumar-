-- =========================================================================================
-- Let a Paytm gateway top-up be recorded before Paytm has confirmed it.
-- =========================================================================================
-- wallet_topup_requests.utr_number is NOT NULL and was restricted to exactly 12 digits:
--
--   CONSTRAINT wallet_topup_utr_format CHECK (utr_number ~ '^[0-9]{12}$')
--
-- That fits a UTR a customer types. A gateway top-up, though, is written when the checkout
-- opens, before any bank reference exists, so startPaytmTopup stores its own order id there
-- (BS followed by digits). The CHECK refused it, and no gateway payment could ever start.
--
-- The relaxation is scoped to PAYTM_PG rows. Every other method - the UTR form and the
-- per-payment Paytm QR - must still carry exactly 12 digits, and the double-spend guard (the
-- partial unique index wallet_topup_utr_claim_idx on utr_number) is not touched. A gateway
-- order id always starts with letters, so it can never collide with a UTR in that index; on
-- settlement a UPI payment's 12-digit reference replaces it, which puts that payment under the
-- same index as the UTR form.
--
-- Idempotent: drops the constraint by name if present and recreates it. The new rule is a
-- superset of the old one, so every existing row already satisfies it. Changes no row.

-- -----------------------------------------------------------------------------------------
-- 1. Accept gateway order ids, on gateway rows only
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.wallet_topup_requests
  DROP CONSTRAINT IF EXISTS wallet_topup_utr_format;

ALTER TABLE public.wallet_topup_requests
  ADD CONSTRAINT wallet_topup_utr_format CHECK (
    utr_number ~ '^[0-9]{12}$'
    OR (method_code = 'PAYTM_PG' AND utr_number ~ '^[A-Za-z0-9_-]{1,64}$')
  );

COMMENT ON COLUMN public.wallet_topup_requests.utr_number IS
  'The payment''s bank reference: the 12-digit UTR for UPI. PAYTM_PG rows hold the gateway '
  'order id until Paytm confirms, then the 12-digit UPI reference when there is one. Unique '
  'among non-rejected rows (wallet_topup_utr_claim_idx), which is the double-spend guard.';

-- -----------------------------------------------------------------------------------------
-- 2. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN pg_get_constraintdef(oid) LIKE '%PAYTM_PG%'
    THEN 'OK - gateway order ids accepted; every other method still needs a 12-digit UTR'
    ELSE 'MISSING - wallet_topup_utr_format still refuses gateway order ids'
  END AS utr_format_constraint
FROM pg_constraint
WHERE conname = 'wallet_topup_utr_format'
  AND conrelid = 'public.wallet_topup_requests'::regclass;
