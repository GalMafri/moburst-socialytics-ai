// supabase/functions/_shared/supabase.ts
//
// The one way a function makes its Supabase client. It is supabase-js's own
// createClient, from the same import every function used, with one change:
// every request goes through wellFormedFetch (text/clip.ts), so half of an
// emoji in a row never reaches the database. PostgREST refuses such a body
// as "Empty or invalid json", which failed drafting on 13 Oct 2026 and a
// client's strategy on 3 Nov. A fetch a caller passes in options.global is
// kept and wrapped the same way. The packaging test fails any function that
// makes its client another way.

import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wellFormedFetch } from "./text/clip.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const createClient = ((url: string, key: string, options?: Any) =>
  createSupabaseClient(url, key, {
    ...(options ?? {}),
    global: { ...(options?.global ?? {}), fetch: wellFormedFetch(options?.global?.fetch) },
  })) as typeof createSupabaseClient;
