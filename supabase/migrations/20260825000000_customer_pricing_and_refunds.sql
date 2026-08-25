-- =========================================================================================
-- Per-customer service pricing/visibility, and delivery counts on broadcasts.
-- =========================================================================================
-- Two features land together because they meet at the same number: what a customer was
-- actually charged for an order decides what a failed call is worth when it is refunded.
--
-- Safe to run more than once.

-- -----------------------------------------------------------------------------------------
-- 1. Per-customer overrides for a service
-- -----------------------------------------------------------------------------------------
-- A service is global: created once, visible to everybody, at one price. A row here is an
-- exception carved out for one customer - a different price, or hidden from their catalogue
-- entirely. No row means that customer sees the service exactly as everyone else does, so
-- the table only ever holds the exceptions and stays small.
--
-- price NULL + is_hidden FALSE is a no-op row rather than an error: it is what remains after
-- an admin clears a custom price but leaves the service visible.
CREATE TABLE IF NOT EXISTS public.customer_service_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  /** Custom price for this customer. NULL means fall back to services.price. */
  price       NUMERIC(12,2),
  /** TRUE hides the service from this customer's catalogue completely. */
  is_hidden   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,

  CONSTRAINT customer_service_overrides_price_non_negative
    CHECK (price IS NULL OR price >= 0),
  -- One row per customer per service. The application upserts on this pair.
  CONSTRAINT customer_service_overrides_unique UNIQUE (user_id, service_id)
);

-- The hot read is "every override for this one customer", when their catalogue is built.
CREATE INDEX IF NOT EXISTS customer_service_overrides_user_idx
  ON public.customer_service_overrides (user_id);

-- Deleting a service must not strand its overrides; the FK cascade handles that, but this
-- index keeps the cascade from a sequential scan.
CREATE INDEX IF NOT EXISTS customer_service_overrides_service_idx
  ON public.customer_service_overrides (service_id);

-- RLS on with no policy at all: every read and write goes through the service-role key in a
-- server action, and a signed-in browser session must never be able to read another
-- customer's pricing - or discover its own by querying around the application.
ALTER TABLE public.customer_service_overrides ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------------------
-- 2. Delivery counts on a broadcast
-- -----------------------------------------------------------------------------------------
-- Recorded when the admin closes an order out against the fulfilment report. These are the
-- inputs the partial refund was computed from, so keeping them on the row makes a refund
-- auditable after the fact instead of only inferable from the ledger.
--
-- Deliberately NOT derived from broadcasts.contact_count: that number is produced by the
-- browser at order time by regex-counting a file, and is a guess. These two come off the
-- real report.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'broadcasts' AND column_name = 'delivered_calls'
  ) THEN
    ALTER TABLE public.broadcasts ADD COLUMN delivered_calls INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'broadcasts' AND column_name = 'failed_calls'
  ) THEN
    ALTER TABLE public.broadcasts ADD COLUMN failed_calls INTEGER;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------------------
-- 3. PARTIAL is a real status now
-- -----------------------------------------------------------------------------------------
-- The server already accepted PARTIAL; the admin UI never offered it and rendered it as
-- "Completed". If this database constrains broadcasts.status to a list, PARTIAL has to be on
-- it. Widen the constraint only when one is actually present, so a database that stores the
-- status as free text is left alone.
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'broadcasts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    AND pg_get_constraintdef(con.oid) ILIKE '%PLACED%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.broadcasts DROP CONSTRAINT %I', v_constraint);
    ALTER TABLE public.broadcasts
      ADD CONSTRAINT broadcasts_status_check
      CHECK (status IN ('PLACED','IN_PROGRESS','COMPLETED','PARTIAL','CANCELLED','ON_HOLD','REFUNDED'));
  END IF;
END
$$;
