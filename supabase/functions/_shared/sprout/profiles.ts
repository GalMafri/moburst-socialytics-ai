// supabase/functions/_shared/sprout/profiles.ts
//
// Every social profile on a Sprout account, from its free metadata endpoint
// (/metadata/customer, not analytics). The setup page's list
// (sprout-profiles) and the client lifecycle's accounts step read it here.

import { defaultSproutCustomerId } from "./customer.ts";

const TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const API_BASE = "https://api.sproutsocial.com/v1";

export interface CustomerProfile {
  id: string;
  /** Sprout's brand name for the profile. */
  name: string;
  native_name: string;
  network_type: string;
  native_link: string;
  status: string;
}

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

export async function sproutAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const clientId = env("SPROUT_CLIENT_ID");
  const clientSecret = env("SPROUT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("The Sprout connection is not configured.");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "organization_id" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`The Sprout connection did not answer (${response.status}).`);
  const data = await response.json();
  if (!data?.access_token) throw new Error("The Sprout connection gave no access token.");
  return String(data.access_token);
}

/** The account's profiles, as Sprout lists them. */
export async function listCustomerProfiles(customerId: string = defaultSproutCustomerId(), fetchImpl: typeof fetch = fetch): Promise<CustomerProfile[]> {
  const token = await sproutAccessToken(fetchImpl);
  const response = await fetchImpl(`${API_BASE}/${encodeURIComponent(customerId)}/metadata/customer`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
    throw new SproutListError(response.status, `Sprout's profile list did not answer (${response.status}).`, detail);
  }
  const data = await response.json();
  // deno-lint-ignore no-explicit-any
  return ((data?.data ?? []) as any[]).map((p) => ({
    id: String(p.customer_profile_id),
    name: String(p.name || ""),
    native_name: String(p.native_name || ""),
    network_type: String(p.network_type || ""),
    native_link: String(p.native_link || ""),
    status: String(p.status || "active"),
  }));
}

export class SproutListError extends Error {
  constructor(public status: number, message: string, public detail: string) {
    super(message);
  }
}
