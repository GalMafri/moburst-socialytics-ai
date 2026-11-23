// The paying desk (supabase/functions/_shared/paid) loads the database client
// from esm.sh at run time, under Deno. Frontend tests that import shared
// server modules reach it, so the type check is told the module exists.
// Types only; nothing here runs.
declare module "https://esm.sh/@supabase/supabase-js@2";
