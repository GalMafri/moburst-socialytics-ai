// supabase/functions/_shared/google/slides.ts
//
// The Slides API calls a deck needs (https://developers.google.com/workspace/
// slides/api/reference/rest/v1/presentations): read a presentation, and one
// batchUpdate of requests.

import type { GoogleApi } from "./api.ts";

export const SLIDES = "https://slides.googleapis.com/v1/presentations";

// deno-lint-ignore no-explicit-any
export type Presentation = { slides?: any[] };
// deno-lint-ignore no-explicit-any
export type Reply = Record<string, any>;

export function getPresentation(api: GoogleApi, id: string): Promise<Presentation> {
  return api.json<Presentation>("GET", `${SLIDES}/${encodeURIComponent(id)}`);
}

export async function batchUpdate(api: GoogleApi, id: string, requests: unknown[]): Promise<Reply[]> {
  if (!requests.length) return [];
  const r = await api.json<{ replies?: Reply[] }>("POST", `${SLIDES}/${encodeURIComponent(id)}:batchUpdate`, { requests });
  return r.replies ?? [];
}
