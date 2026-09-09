-- =========================================================================================
-- Per-category audio requirement.
-- =========================================================================================
-- Some categories are not voice at all - an SMS category has no recording to attach - so
-- whether the order form demands audio becomes a property of the category rather than a rule
-- for the whole panel.
--
-- Additive and idempotent: it adds one column with a default that preserves today's
-- behaviour, and relaxes one NOT NULL. It changes no existing value, drops nothing, and is
-- safe to run twice or against a live database serving traffic.
--
-- Until this runs, the application probes for the column and requires audio on every order,
-- exactly as it did before - see hasCategoryAudioColumn() in src/lib/supabase/schema.ts.

-- -----------------------------------------------------------------------------------------
-- 1. The column
-- -----------------------------------------------------------------------------------------
-- DEFAULT true so every category that already exists keeps demanding a recording. Opting a
-- category out is a deliberate act by an operator, never something a migration does silently
-- to a live catalogue.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS requires_audio BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.categories.requires_audio IS
  'Whether an order in this category must carry a recording or TTS script. False for '
  'non-voice categories such as SMS.';

-- -----------------------------------------------------------------------------------------
-- 2. Let an order exist without audio
-- -----------------------------------------------------------------------------------------
-- broadcasts.audio_key was NOT NULL from the beginning, when every order was a voice
-- broadcast. An order in a category that requires no audio has nothing to put here, so the
-- column has to accept NULL or the insert fails outright.
--
-- This does not weaken anything: whether audio is required is enforced in createBroadcast
-- against the category's own flag, which is a rule the database column could never express.
ALTER TABLE public.broadcasts
  ALTER COLUMN audio_key DROP NOT NULL;

-- -----------------------------------------------------------------------------------------
-- 3. Check
-- -----------------------------------------------------------------------------------------
-- Should print one row reading OK.
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'requires_audio'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'broadcasts'
        AND column_name = 'audio_key' AND is_nullable = 'YES'
    )
    THEN 'OK - categories.requires_audio present and broadcasts.audio_key is nullable'
    ELSE 'MISSING - re-run this migration'
  END AS category_audio;
