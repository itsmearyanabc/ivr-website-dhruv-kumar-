-- =========================================================================================
-- Operator-controlled ordering for the services inside a category.
-- =========================================================================================
-- Additive and idempotent: adds one column, backfills it, indexes it. Changes no existing
-- value, drops nothing, and is safe to run twice or against a live database serving traffic.
--
-- Until this runs, the application probes for the column and falls back to ordering by
-- created_at, exactly as it did before. Nothing breaks on a deployment that is ahead of its
-- migrations - see hasServiceSortOrder() in src/lib/supabase/schema.ts.

-- -----------------------------------------------------------------------------------------
-- 1. The column
-- -----------------------------------------------------------------------------------------
-- Nullable with no default on purpose. A NULL means "never explicitly placed", and the reads
-- sort those last by their creation date, so a service added by an operator who has not
-- touched the ordering still appears where they would expect it - at the bottom of its
-- category - rather than jumping to the top on a default of 0.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

COMMENT ON COLUMN public.services.sort_order IS
  'Position within the category, ascending. NULL = never placed by hand; those sort last by created_at.';

-- -----------------------------------------------------------------------------------------
-- 2. Backfill
-- -----------------------------------------------------------------------------------------
-- Existing services keep the order they are already displayed in, which is creation order.
-- Numbered per category rather than globally, because the position only means anything
-- relative to the siblings it is drawn beside.
--
-- Guarded so a re-run does not renumber an ordering the operator has since arranged by hand:
-- only rows still NULL are given a position.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY created_at, id) AS position
  FROM public.services
  WHERE sort_order IS NULL
)
UPDATE public.services AS s
SET sort_order = ranked.position
FROM ranked
WHERE s.id = ranked.id;

-- -----------------------------------------------------------------------------------------
-- 3. Index
-- -----------------------------------------------------------------------------------------
-- Every read of a category's services is "this category, in order", both on the admin screen
-- and on the customer's order form. This is that access path exactly.
CREATE INDEX IF NOT EXISTS idx_services_category_sort
  ON public.services (category_id, sort_order, created_at);

-- -----------------------------------------------------------------------------------------
-- 4. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'sort_order'
    )
    THEN 'OK - services.sort_order present'
    ELSE 'MISSING - services.sort_order was not created'
  END AS service_sort_order;
