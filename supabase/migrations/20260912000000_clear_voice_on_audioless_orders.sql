-- =========================================================================================
-- Take the voice actor off orders whose category never had one.
-- =========================================================================================
-- broadcasts.voice_type defaults to 'MALE', and the new-broadcast form posts that default
-- even for a category with requires_audio = false - an SMS run. Nothing records a voice for
-- those orders, but every screen that lists them showed "Male" beside them, which reads as a
-- setting the customer chose.
--
-- The code now stores NULL for such an order. This clears the ones already recorded, matching
-- on category_id where the order has one and on the category name for older rows that predate
-- that column. Touches nothing else: orders under a category that does take audio keep their
-- voice, and no other column is written.

-- -----------------------------------------------------------------------------------------
-- 1. Orders linked to their category by id
-- -----------------------------------------------------------------------------------------
UPDATE public.broadcasts b
SET voice_type = NULL
FROM public.categories c
WHERE b.category_id = c.id
  AND c.requires_audio = FALSE
  AND b.voice_type IS NOT NULL;

-- -----------------------------------------------------------------------------------------
-- 2. Older orders that only carry the category's name
-- -----------------------------------------------------------------------------------------
UPDATE public.broadcasts b
SET voice_type = NULL
FROM public.categories c
WHERE b.category_id IS NULL
  AND b.category_name = c.name
  AND c.requires_audio = FALSE
  AND b.voice_type IS NOT NULL;

-- -----------------------------------------------------------------------------------------
-- 3. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN COUNT(*) = 0
    THEN 'OK - no voice recorded against an order whose category takes no audio'
    ELSE 'LEFT OVER - ' || COUNT(*)::text || ' such orders still carry a voice'
  END AS voice_cleanup
FROM public.broadcasts b
JOIN public.categories c
  ON c.id = b.category_id OR (b.category_id IS NULL AND c.name = b.category_name)
WHERE c.requires_audio = FALSE
  AND b.voice_type IS NOT NULL;
