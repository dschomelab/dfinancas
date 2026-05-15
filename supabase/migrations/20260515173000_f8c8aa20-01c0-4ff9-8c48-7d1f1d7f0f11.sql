ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS attributed_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tx_attributed_to_user_id ON public.transactions(attributed_to_user_id);

DROP POLICY IF EXISTS "cat select own" ON public.categories;

CREATE POLICY "cat select own or shared" ON public.categories
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.category_id = categories.id
      AND (
        t.user_id = auth.uid()
        OR (t.group_id IS NOT NULL AND public.is_group_member(t.group_id, auth.uid()))
      )
  )
);
