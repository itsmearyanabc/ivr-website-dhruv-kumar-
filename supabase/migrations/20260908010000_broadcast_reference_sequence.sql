-- =========================================================================================
-- Broadcast references: strictly BR-0001, allocated by a sequence.
-- =========================================================================================
-- Two problems are fixed here.
--
-- 1. The application picked the next number by reading the newest rows back, parsing them and
--    adding one. Two orders placed at the same moment computed the same reference; the UNIQUE
--    constraint on reference_no then failed the second insert, and the customer was told
--    "Failed to create broadcast order" for a collision they had no part in. The read also
--    scanned only the ten newest rows and stopped at the first BR-NNNN it recognised, so a
--    run of legacy references at the top of the table sent the counter back to BR-0001.
--
-- 2. Older orders carry references in two earlier formats - BR-<epoch-ms>-<random> and a
--    short random string such as BR-S70UPJOR - so the broadcast list mixed three shapes in
--    one column.
--
-- A sequence solves the first: nextval is atomic and concurrent callers cannot be handed the
-- same value. The backfill in section 3 solves the second by renumbering every existing order
-- chronologically, so the whole table reads BR-0001, BR-0002, ... in the order the orders
-- were actually placed.
--
-- Idempotent and safe to run twice: the sequence and function are created only if absent, and
-- the backfill skips any database whose references are already all in the canonical shape.
--
-- NOTE: the backfill CHANGES the reference a customer may already have seen on an existing
-- order. That is the point of the change, and transactions.order_id is rewritten in the same
-- transaction so the money trail still joins. Nothing else stores a broadcast reference -
-- reports and broadcast_status_history both key off broadcasts.id, which is untouched.

-- -----------------------------------------------------------------------------------------
-- 1. The sequence
-- -----------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.broadcast_reference_seq AS BIGINT START WITH 1;

COMMENT ON SEQUENCE public.broadcast_reference_seq IS
  'Allocates broadcasts.reference_no. Read through next_broadcast_reference(), never directly.';

-- -----------------------------------------------------------------------------------------
-- 2. The allocator
-- -----------------------------------------------------------------------------------------
-- lpad to 4 keeps the reference a minimum of four digits, which is the format asked for. Past
-- 9999 it widens to five rather than wrapping and colliding - a number that cannot be issued
-- twice matters more than a fixed column width.
--
-- SECURITY DEFINER because the sequence is not otherwise reachable by a customer's role, and
-- placing an order has to be able to draw a number.
CREATE OR REPLACE FUNCTION public.next_broadcast_reference()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'BR-' || lpad(nextval('public.broadcast_reference_seq')::TEXT, 4, '0');
$$;

GRANT EXECUTE ON FUNCTION public.next_broadcast_reference() TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------
-- 3. Renumber what is already there
-- -----------------------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_total   BIGINT;
  v_renamed BIGINT := 0;
BEGIN
  -- Nothing to do when every reference is already canonical - which is what a second run of
  -- this migration sees.
  IF NOT EXISTS (
    SELECT 1 FROM public.broadcasts WHERE reference_no !~ '^BR-\d{4,}$'
  ) THEN
    RAISE NOTICE 'Backfill skipped: all references already canonical.';
  ELSE
    -- The mapping, fixed up front so both updates below agree on it.
    CREATE TEMP TABLE _ref_map ON COMMIT DROP AS
    SELECT
      id,
      reference_no AS old_ref,
      'BR-' || lpad(ROW_NUMBER() OVER (ORDER BY created_at, id)::TEXT, 4, '0') AS new_ref
    FROM public.broadcasts;

    -- reference_no is UNIQUE and the constraint is checked per row, so going straight to the
    -- new numbering would collide the moment a target name is still held by another row.
    -- Park everything on a temporary name first; the id is unique, so these cannot clash.
    UPDATE public.broadcasts AS b
    SET reference_no = 'TMP-' || b.id::TEXT
    FROM _ref_map m
    WHERE b.id = m.id AND m.old_ref IS DISTINCT FROM m.new_ref;

    UPDATE public.broadcasts AS b
    SET reference_no = m.new_ref
    FROM _ref_map m
    WHERE b.id = m.id AND b.reference_no LIKE 'TMP-%';

    GET DIAGNOSTICS v_renamed = ROW_COUNT;

    -- The money trail. transactions.order_id holds a broadcast reference as plain text: the
    -- reference itself for the original debit and any refund, and reference || '-ADJ' for a
    -- partial-delivery adjustment. Both forms are rewritten. Rows whose order_id matches no
    -- old reference - wallet top-ups, MANUAL_FUND_BY_ADMIN - are left alone.
    UPDATE public.transactions AS t
    SET order_id = m.new_ref
    FROM _ref_map m
    WHERE t.order_id = m.old_ref AND m.old_ref IS DISTINCT FROM m.new_ref;

    UPDATE public.transactions AS t
    SET order_id = m.new_ref || '-ADJ'
    FROM _ref_map m
    WHERE t.order_id = m.old_ref || '-ADJ' AND m.old_ref IS DISTINCT FROM m.new_ref;

    RAISE NOTICE 'Backfill renumbered % broadcast reference(s).', v_renamed;
  END IF;

  -- Park the sequence past the highest number in use, however this database arrived at it, so
  -- the next order cannot be handed a reference that already exists.
  SELECT COALESCE(MAX(substring(reference_no FROM '^BR-(\d+)$')::BIGINT), 0)
  INTO v_total
  FROM public.broadcasts;

  PERFORM setval('public.broadcast_reference_seq', GREATEST(v_total, 1), v_total > 0);
END
$backfill$;

-- -----------------------------------------------------------------------------------------
-- 4. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK, and a second confirming the allocator is installed.
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.broadcasts WHERE reference_no !~ '^BR-\d{4,}$')
    THEN 'OK - every broadcast reference is BR-NNNN'
    ELSE 'MISSING - ' || (
      SELECT count(*)::TEXT FROM public.broadcasts WHERE reference_no !~ '^BR-\d{4,}$'
    ) || ' reference(s) still in a legacy format'
  END AS references_canonical;

SELECT
  CASE
    WHEN to_regprocedure('public.next_broadcast_reference()') IS NOT NULL
    THEN 'OK - next_broadcast_reference() available'
    ELSE 'MISSING - allocator was not created'
  END AS allocator;
