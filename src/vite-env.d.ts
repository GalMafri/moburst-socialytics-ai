/// <reference types="vite/client" />

// Shared server modules imported by frontend tests use this runtime API.
// This declaration adds types only; it does not expose server secrets.
declare namespace Deno {
  const env: {
    get(name: string): string | undefined;
  };
}
