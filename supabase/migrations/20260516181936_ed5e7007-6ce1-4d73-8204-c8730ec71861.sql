
-- 1) Add responsible user column on transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS attributed_to_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_tx_attributed_to_user_id
  ON public.transactions(attributed_to_user_id);

-- 2) Backfill from existing free-text attributed_to
UPDATE public.transactions t
SET attributed_to_user_id = p.id
FROM public.profiles p
WHERE t.attributed_to_user_id IS NULL
  AND t.attributed_to IS NOT NULL
  AND (
    lower(btrim(p.display_name)) = lower(btrim(t.attributed_to))
    OR lower(coalesce(p.email,'')) = lower(btrim(t.attributed_to))
  );

-- Default the responsible to the creator when neither is set
UPDATE public.transactions
SET attributed_to_user_id = user_id
WHERE attributed_to_user_id IS NULL;

-- 3) Share categories across all authenticated users (read-only for all,
--    edits remain restricted to the owner).
DROP POLICY IF EXISTS "cat select own" ON public.categories;

CREATE POLICY "cat select all authenticated"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (true);
