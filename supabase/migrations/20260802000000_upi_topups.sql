-- =========================================================================================
-- Migration: UPI static-QR wallet top-ups with UTR reconciliation
-- =========================================================================================
-- Additive only. This migration never drops or alters an existing table, so it is safe to
-- run against the live database.
--
-- Design notes (security critical, please read before changing anything here):
--   * A UTR is money. `wallet_topup_utr_claim_idx` is a PARTIAL UNIQUE index that makes it
--     physically impossible for two non-rejected rows to claim the same UTR. This is the
--     real double-spend guard - application checks are only a nicer error message on top.
--     Rejected rows are excluded so a genuine typo can be corrected and resubmitted.
--   * Crediting the wallet is done ONLY by approve_wallet_topup(), which locks the request
--     row FOR UPDATE and re-checks the status inside the same transaction. Two admins
--     double-clicking Approve at the same moment can therefore only ever credit once.
--   * payment_methods holds DISPLAY configuration only (UPI id, payee name, QR image,
--     limits, instructions). Aggregator API keys and secrets must live in environment
--     variables and never in this table - it is world-readable by design so the customer
--     top-up screen can render the QR.

-- -----------------------------------------------------------------------------------------
-- 1. Payment method configuration (admin editable, non-secret)
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  code                 TEXT PRIMARY KEY,
  label                TEXT NOT NULL,
  is_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  upi_vpa              TEXT,
  upi_payee_name       TEXT,
  qr_image_key         TEXT,
  min_amount           NUMERIC(12,2) NOT NULL DEFAULT 100.00,
  max_amount           NUMERIC(12,2) NOT NULL DEFAULT 100000.00,
  instructions         TEXT,
  -- MANUAL      : admin reviews every UTR in the panel before the wallet is credited
  -- DECENTRO    : backend queries the aggregator; a confident match can auto-credit
  verification_mode    TEXT NOT NULL DEFAULT 'MANUAL',
  -- Only honoured when verification_mode <> 'MANUAL'. When false, an automatic match is
  -- recorded on the request but a human still presses Approve.
  auto_credit_on_match BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_methods_amount_range CHECK (min_amount > 0 AND max_amount >= min_amount),
  CONSTRAINT payment_methods_mode CHECK (verification_mode IN ('MANUAL', 'DECENTRO'))
);

-- Seed the UPI QR method. Disabled until an admin fills in the UPI id and QR image.
INSERT INTO public.payment_methods (code, label, is_enabled, instructions)
VALUES (
  'UPI_QR',
  'UPI QR (manual UTR verification)',
  FALSE,
  'Scan the QR with any UPI app, pay the exact amount you want added, then copy the 12-digit UTR / transaction reference from your payment app and submit it below.'
)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------------------
-- 2. Top-up request ledger
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_topup_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no       TEXT UNIQUE NOT NULL,
  user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  method_code        TEXT NOT NULL DEFAULT 'UPI_QR' REFERENCES public.payment_methods(code),

  -- What the customer claims they paid, and the bank reference for it.
  amount             NUMERIC(12,2) NOT NULL,
  utr_number         TEXT NOT NULL,

  status             TEXT NOT NULL DEFAULT 'PENDING',

  -- Outcome of the automated lookup, if one ran. Store only non-sensitive fields here.
  verification_mode  TEXT NOT NULL DEFAULT 'MANUAL',
  verification_state TEXT NOT NULL DEFAULT 'NOT_CHECKED',
  verified_amount    NUMERIC(12,2),
  verification_note  TEXT,
  verified_at        TIMESTAMPTZ,

  -- Admin decision trail.
  admin_note         TEXT,
  rejection_reason   TEXT,
  reviewed_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  credited_amount    NUMERIC(12,2),

  -- Abuse forensics. We keep a salted hash, never the raw IP address.
  submitted_ip_hash  TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT wallet_topup_amount_positive CHECK (amount > 0),
  CONSTRAINT wallet_topup_utr_format CHECK (utr_number ~ '^[0-9]{12}$'),
  CONSTRAINT wallet_topup_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT wallet_topup_verification_state CHECK (
    verification_state IN ('NOT_CHECKED', 'MATCHED', 'AMOUNT_MISMATCH', 'NOT_FOUND', 'ERROR')
  )
);

-- The double-spend guard. A UTR can be claimed by exactly one live request, ever.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topup_utr_claim_idx
  ON public.wallet_topup_requests (utr_number)
  WHERE status <> 'REJECTED';

CREATE INDEX IF NOT EXISTS wallet_topup_user_idx
  ON public.wallet_topup_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_topup_queue_idx
  ON public.wallet_topup_requests (status, created_at DESC);

-- -----------------------------------------------------------------------------------------
-- 3. Rate-limit audit trail
-- -----------------------------------------------------------------------------------------
-- Every submission attempt lands here whether or not it produced a request row, so brute
-- forcing UTRs is both throttled and visible.
CREATE TABLE IF NOT EXISTS public.topup_submission_attempts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ip_hash    TEXT,
  outcome    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS topup_attempts_user_idx
  ON public.topup_submission_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS topup_attempts_ip_idx
  ON public.topup_submission_attempts (ip_hash, created_at DESC);

-- -----------------------------------------------------------------------------------------
-- 4. Atomic approval
-- -----------------------------------------------------------------------------------------
-- Locks the request, re-checks it is still PENDING, writes the transaction row and moves the
-- balance - all inside one transaction. Never credit a wallet from application code.
CREATE OR REPLACE FUNCTION public.approve_wallet_topup(
  p_request_id UUID,
  p_admin_id   UUID,
  p_note       TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_balance NUMERIC) AS $$
DECLARE
  v_request public.wallet_topup_requests%ROWTYPE;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_request
  FROM public.wallet_topup_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Top-up request not found.'::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RETURN QUERY SELECT FALSE,
      format('This request was already %s.', lower(v_request.status))::TEXT,
      0::NUMERIC;
    RETURN;
  END IF;

  INSERT INTO public.transactions (user_id, amount, type, status, order_id)
  VALUES (v_request.user_id, v_request.amount, 'CREDIT', 'SUCCESS', v_request.reference_no);

  UPDATE public.users
  SET balance = balance + v_request.amount
  WHERE id = v_request.user_id
  RETURNING balance INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet owner % no longer exists', v_request.user_id;
  END IF;

  UPDATE public.wallet_topup_requests
  SET status          = 'APPROVED',
      reviewed_by     = p_admin_id,
      reviewed_at     = NOW(),
      admin_note      = COALESCE(p_note, admin_note),
      credited_amount = v_request.amount,
      updated_at      = NOW()
  WHERE id = p_request_id;

  RETURN QUERY SELECT TRUE, 'Top-up approved and wallet credited.'::TEXT, v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rejection is a single conditional update, but it lives here too so both decisions share
-- the same "only a PENDING request can be decided" rule.
CREATE OR REPLACE FUNCTION public.reject_wallet_topup(
  p_request_id UUID,
  p_admin_id   UUID,
  p_reason     TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.wallet_topup_requests
  SET status           = 'REJECTED',
      rejection_reason = p_reason,
      reviewed_by      = p_admin_id,
      reviewed_at      = NOW(),
      updated_at       = NOW()
  WHERE id = p_request_id
    AND status = 'PENDING';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN QUERY SELECT FALSE, 'Request not found or already decided.'::TEXT;
  ELSE
    RETURN QUERY SELECT TRUE, 'Top-up request rejected.'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- These are called from server actions holding the service-role key, which bypasses RLS.
-- No grant to `authenticated` - a signed-in browser session must never be able to call
-- approve_wallet_topup() directly.
REVOKE ALL ON FUNCTION public.approve_wallet_topup(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_wallet_topup(UUID, UUID, TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------------------
-- 5. Row level security
-- -----------------------------------------------------------------------------------------
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_topup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topup_submission_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view payment methods" ON public.payment_methods;
CREATE POLICY "Anyone can view payment methods"
  ON public.payment_methods FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Admins manage payment methods" ON public.payment_methods;
CREATE POLICY "Admins manage payment methods"
  ON public.payment_methods FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Customers view own topups" ON public.wallet_topup_requests;
CREATE POLICY "Customers view own topups"
  ON public.wallet_topup_requests FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins view all topups" ON public.wallet_topup_requests;
CREATE POLICY "Admins view all topups"
  ON public.wallet_topup_requests FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins update topups" ON public.wallet_topup_requests;
CREATE POLICY "Admins update topups"
  ON public.wallet_topup_requests FOR UPDATE USING (public.is_admin());

-- Deliberately no INSERT policy: requests are only ever created by the server action, which
-- validates the amount against the configured limits and applies rate limiting first.

DROP POLICY IF EXISTS "Admins view submission attempts" ON public.topup_submission_attempts;
CREATE POLICY "Admins view submission attempts"
  ON public.topup_submission_attempts FOR SELECT USING (public.is_admin());
