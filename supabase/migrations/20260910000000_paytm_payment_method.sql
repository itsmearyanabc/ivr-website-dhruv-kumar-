-- =========================================================================================
-- Paytm Payment Gateway as a second way into the wallet.
-- =========================================================================================
-- Additive and idempotent. Adds one row and widens one CHECK; changes no existing row, drops
-- nothing, and is safe to run twice or against a live database serving traffic.
--
-- wallet_topup_requests.method_code is a foreign key to payment_methods.code, so a gateway
-- top-up cannot be recorded at all until that row exists. Without this migration every Paytm
-- payment would fail at the insert, before the customer ever reached the checkout.
--
-- The UPI/UTR method is untouched and keeps working exactly as it does today.

-- -----------------------------------------------------------------------------------------
-- 1. Let a payment method say it is verified by Paytm
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_mode;

ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_mode
  CHECK (verification_mode IN ('MANUAL', 'DECENTRO', 'GENERIC_UPI', 'PAYTM'));

-- -----------------------------------------------------------------------------------------
-- 2. The method itself
-- -----------------------------------------------------------------------------------------
-- auto_credit_on_match is TRUE because that is the whole point of a gateway: Paytm confirming
-- the payment IS the verification, and there is no human step left to add. The credit still
-- only happens after the server has asked Paytm directly - see settlePaytmOrder.
INSERT INTO public.payment_methods (
  code, label, is_enabled, min_amount, max_amount,
  instructions, verification_mode, auto_credit_on_match
)
VALUES (
  'PAYTM_PG',
  'Card, UPI & Netbanking (Paytm)',
  TRUE,
  100,
  100000,
  'Pay by card, UPI or netbanking. Your wallet is credited as soon as the payment succeeds.',
  'PAYTM',
  TRUE
)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------------------
-- 3. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.payment_methods WHERE code = 'PAYTM_PG')
    THEN 'OK - PAYTM_PG payment method present'
    ELSE 'MISSING - the Paytm method row was not created'
  END AS paytm_method;
