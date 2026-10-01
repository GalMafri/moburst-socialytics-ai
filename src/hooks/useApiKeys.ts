/**
 * API keys, read and written through the api function's admin routes with
 * the signed-in admin's session, so the Settings card and machine callers
 * share one code path. Plain fetch (DELETE has no invoke helper).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  company_slugs: string[] | null;
  client_ids: string[] | null;
  rate_limit_per_minute: number;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  note: string | null;
}

export interface CreateKeyInput {
  name: string;
  scopes: string[];
  company_slugs: string[];
  expires_at: string | null;
}

export type CreatedKey = ApiKey & { key: string; warning: string };

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/v1/admin/keys`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You need to be signed in.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `The request failed (${res.status}).`);
  return body as T;
}

export function useApiKeys(enabled = true) {
  return useQuery({
    queryKey: ["api_keys"],
    queryFn: async () => (await request<{ data: ApiKey[] }>(BASE, { method: "GET" })).data,
    enabled,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateKeyInput) => (await request<{ data: CreatedKey }>(BASE, { method: "POST", body: JSON.stringify(input) })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api_keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => request<void>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api_keys"] }),
  });
}
