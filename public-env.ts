// The public VITE_* values this app is built with, and the one place they live.
//
// Vite inlines every VITE_* into the client bundle, so all of these are public by
// construction: the project ref, the Supabase URL, the Hub URL, and the Supabase
// ANON key (role "anon"; data is protected by RLS, not by hiding this). Never add
// a service-role key or any real secret here — that belongs in the edge-function
// environment.
//
// .env is untracked and optional. It, and the process environment, win over these;
// these only fill gaps, so neither a missing nor a locally customized .env can
// break a build.
//
// Imported by BOTH vite.config.ts and vitest.config.ts. These defaults used to sit
// inside vite.config.ts, which vitest does not read: a test that imports
// src/integrations/supabase/client.ts then failed on "supabaseUrl is required"
// while the build passed. No suite imports it today, so nothing was breaking, but
// the first one to would have. Sharing one copy keeps the build and the test run
// from disagreeing about what the app needs.
export const PUBLIC_DEFAULTS: Record<string, string> = {
  VITE_SUPABASE_PROJECT_ID: "rwouwxqggjjacbpbhqsn",
  VITE_SUPABASE_URL: "https://rwouwxqggjjacbpbhqsn.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3b3V3eHFnZ2pqYWNicGJocXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjI5MjUsImV4cCI6MjA4NjI5ODkyNX0.MVh6NOBLeBFvgYlxa9Ye9y6fTX3fQrMuo-YcwwJL5hU",
  VITE_HUB_BACKEND_URL: "https://tools-server.moburst.com",
};

/** Values the client cannot start without. Each must have a default above. */
export const REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

/**
 * Fill any VITE_* the environment does not already supply. `fileEnv` is what
 * Vite's loadEnv found in .env files; pass it so a real .env still wins.
 */
export function applyPublicEnvDefaults(fileEnv: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries(PUBLIC_DEFAULTS)) {
    if (!fileEnv[key] && !process.env[key]) process.env[key] = value;
  }
}
