-- Older permissive staff policies can survive migrations under different names.
-- Restrictive guards are ANDed with every existing grant, so those policies
-- cannot bypass company scope. Preserve existing grants and admin behavior.
DO $$
DECLARE t text; scope_column text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','reports','post_iterations','sprout_profiles'] LOOP
    scope_column := CASE WHEN t = 'clients' THEN 'id' ELSE 'client_id' END;
    EXECUTE format('DROP POLICY IF EXISTS "Enforce client scope" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Enforce client scope" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.can_access_client(%I)) WITH CHECK (public.can_write_client(%I))', t, scope_column, scope_column);
    EXECUTE format('DROP POLICY IF EXISTS "Enforce client delete scope" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Enforce client delete scope" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_write_client(%I))', t, scope_column);
  END LOOP;
END $$;
