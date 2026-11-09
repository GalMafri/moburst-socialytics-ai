// Where a test's code lives. Edge function tests sit under supabase/tests at
// the same path their code has under supabase/functions, because a deploy
// uploads a function's folder and all of _shared as they are: test files
// there were shipped with every function (1.25 MB of _shared on 9 Nov 2026,
// against a 4 MB budget). Paths to supabase/migrations and supabase/fixtures
// keep the same depth from either folder.
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));

/** supabase/functions. */
export const functionsDir = resolve(testsDir, "..", "functions");

/** The folder under supabase/functions that the test at `url` covers. */
export const codeDir = (url: string): string => join(functionsDir, relative(testsDir, dirname(fileURLToPath(url))));
