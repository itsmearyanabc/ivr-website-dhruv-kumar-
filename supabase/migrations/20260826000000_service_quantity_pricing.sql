-- =========================================================================================
-- Quantity-based service pricing.
-- =========================================================================================
-- A service used to bill one flat price per order, however many numbers the campaign carried.
-- It can now bill per number: `price` covers `unit_quantity` units, and an order for N units
-- costs price * N / unit_quantity. "100 SMS - Rs 11.00" is price 11, unit_quantity 100.
--
-- `min_quantity` and `max_quantity` already existed on this table (added by
-- 20260719000002_atomic_balance_and_enums.sql) but were never read or written by the
-- application. They are the order bounds now, so this migration only adds the constraints and
-- the index they were missing.
--
-- Safe to run more than once.

-- -----------------------------------------------------------------------------------------
-- 1. Units a price covers
-- -----------------------------------------------------------------------------------------
-- NULL is meaningful and is the default: it marks a service that still bills a flat price per
-- order, which is how every service behaved before this migration. Backfilling it to 1 would
-- silently reprice the entire live catalogue - a service selling at Rs 11 would start charging
-- Rs 11 *per number* - so existing rows are deliberately left alone and an operator opts each
-- service in by setting the field in Admin -> Services.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'unit_quantity'
  ) THEN
    ALTER TABLE public.services ADD COLUMN unit_quantity INTEGER;
  END IF;

  -- Both of these normally exist already; create them for any database provisioned from an
  -- older copy of the schema so the application can rely on them being present.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'min_quantity'
  ) THEN
    ALTER TABLE public.services ADD COLUMN min_quantity INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'max_quantity'
  ) THEN
    ALTER TABLE public.services ADD COLUMN max_quantity INTEGER;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------------------
-- 2. Bounds that cannot be nonsense
-- -----------------------------------------------------------------------------------------
-- A zero or negative unit_quantity would divide by zero when quoting; a max below its own min
-- would make the service unorderable at any quantity while still appearing in the catalogue.
-- Both are cheap to prevent here and expensive to diagnose from a customer's "it says my
-- order is too small AND too large" report.
--
-- Dropped and recreated rather than added conditionally so that re-running the migration
-- after a definition change converges instead of leaving the old rule in place.
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_unit_quantity_positive;
ALTER TABLE public.services
  ADD CONSTRAINT services_unit_quantity_positive
  CHECK (unit_quantity IS NULL OR unit_quantity > 0);

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_min_quantity_positive;
ALTER TABLE public.services
  ADD CONSTRAINT services_min_quantity_positive
  CHECK (min_quantity IS NULL OR min_quantity > 0);

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_max_quantity_positive;
ALTER TABLE public.services
  ADD CONSTRAINT services_max_quantity_positive
  CHECK (max_quantity IS NULL OR max_quantity > 0);

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_max_not_below_min;
ALTER TABLE public.services
  ADD CONSTRAINT services_max_not_below_min
  CHECK (min_quantity IS NULL OR max_quantity IS NULL OR max_quantity >= min_quantity);

-- -----------------------------------------------------------------------------------------
-- 3. Report
-- -----------------------------------------------------------------------------------------
-- Every row should read OK. `unit_quantity` reports how many services are opted in so far,
-- which is expected to be 0 immediately after the migration runs.
SELECT
  'services.unit_quantity' AS item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'unit_quantity'
  ) THEN 'OK' ELSE 'MISSING' END AS status,
  (SELECT COUNT(*) FROM public.services WHERE unit_quantity IS NOT NULL)::TEXT
    || ' service(s) quantity-priced' AS detail
UNION ALL
SELECT
  'services.min_quantity',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'min_quantity'
  ) THEN 'OK' ELSE 'MISSING' END,
  ''
UNION ALL
SELECT
  'services.max_quantity',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'max_quantity'
  ) THEN 'OK' ELSE 'MISSING' END,
  '';
