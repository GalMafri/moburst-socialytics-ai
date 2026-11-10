/**
 * A person's own API keys, read and written through the api function's
 * /v1/me/keys routes with their signed-in session: the same plain fetch as
 * useApiKeys, which does this for the admin routes. Only Moburst staff have
 * personal keys; the route and the sidebar entry are staff only, and the
 * server checks again on every call.
 *
 * The plaintext key comes back once, from the create call, and is never put
 * in the query cache: the list is read again from the server, which returns
 * only each key's prefix.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PersonalKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type CreatedPersonalKey = PersonalKey & { key: string };

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/v1/me/keys`;
const LIST_KEY = ["personal_api_keys"] as const;

/**
 * A request the server answered with an error, carrying its status and code
 * so the screen can choose what to say. `context.status` is where
 * sendQuietly's resend rule (safeToResend) reads the status.
 */
export class PersonalKeyError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly context: { status: number | null };
  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "PersonalKeyError";
    this.status = status;
    this.code = code;
    this.context = { status };
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PersonalKeyError("You need to be signed in.", null, null);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof body?.error?.code === "string" ? body.error.code : null;
    const message = typeof body?.error?.message === "string" ? body.error.message : `The request failed (${res.status}).`;
    throw new PersonalKeyError(message, res.status, code);
  }
  return body as T;
}

export function usePersonalKeys(enabled = true) {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await request<{ data: PersonalKey[] }>(BASE, { method: "GET" })).data,
    enabled,
  });
}

export function useCreatePersonalKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await request<{ data: CreatedPersonalKey }>(BASE, { method: "POST", body: JSON.stringify({ name }) })).data,
    // The answer holds the plaintext key: dropped from the mutation cache as
    // soon as the screen lets go of it (reset), not kept for five minutes.
    gcTime: 0,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      // The admin list in Settings shows every key, this one included.
      qc.invalidateQueries({ queryKey: ["api_keys"] });
    },
  });
}

export function useRevokePersonalKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await request<{ data: { id: string; revoked_at: string } }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" })).data,
    onSuccess: (revoked) => {
      // Shown as revoked at once; the read that follows confirms it.
      qc.setQueryData<PersonalKey[]>(LIST_KEY, (keys) => keys?.map((k) => (k.id === revoked.id ? { ...k, revoked_at: revoked.revoked_at } : k)));
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: ["api_keys"] });
    },
  });
}
