import { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { initHubToken, clearHubToken } from "@/utils/hubAuth";
import { getGosHandoffToken, rememberPortal } from "@/utils/gosAuth";
import { isAuthErrorCode, isRefusal, isTransient, BRIDGE_ERROR_CODES, type AuthErrorCode } from "@/lib/authMessages";
import { rememberIntendedDestination } from "@/utils/returnTo";
import { supabase } from "@/integrations/supabase/client";
import { strongestRole } from "@/lib/roles";

const HUB_API_URL = import.meta.env.VITE_HUB_BACKEND_URL || "https://tools-server.moburst.com";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export interface HubUser {
  _id: string;
  name: string;
  email: string;
  role: string; // global: "user" | "admin"
  company: string;
  isActive: boolean;
  tools: Array<{ tool: { _id: string; name: string; url?: string }; role: string }>;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "admin" | "moburst_user" | "client" | null;

// Pure dev fallback (no Supabase session, no data). Used only when the app is
// loaded from a Lovable preview URL and localStorage still has a cached
// Supabase session from the legacy Auth.tsx signup. If the cached session is
// admin, data flows via that. If not, RLS blocks — which is fine, Lovable
// preview is for UI iteration, real data testing happens via the Hub.
const HOSTNAME = window.location.hostname;
const IS_LOVABLE_PREVIEW =
  import.meta.env.DEV ||
  HOSTNAME.startsWith("id-preview-") ||
  HOSTNAME.endsWith(".lovableproject.com") ||
  HOSTNAME === "localhost" ||
  HOSTNAME === "127.0.0.1";

const DEV_USER: HubUser = {
  _id: "00000000-0000-0000-0000-000000000000",
  name: "Dev user",
  email: "dev@localhost",
  role: "admin",
  company: "Moburst",
  isActive: true,
  tools: [{ tool: { _id: "dev", name: "Socialytics" }, role: "Admin" }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

interface AuthContextType {
  user: HubUser | null;
  userRole: UserRole;
  isAdmin: boolean;
  isMoburstStaff: boolean;
  isClient: boolean;
  canDelete: boolean;
  canManageClients: boolean;
  canRunAnalysis: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  // Why sign-in did not happen, as a reason code (src/lib/authMessages.ts). Never raw text.
  authError: AuthErrorCode | null;
  // True when the session came from gOS (moburst.ai). For gOS sessions, client
  // scoping is enforced by RLS via allowed_company_slugs, so the client-side
  // company-NAME filters (which only understand the legacy single-company model)
  // should defer to RLS instead of hiding rows.
  isGosSession: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// What a bridge answered, as a reason code. The raw text goes to the console
// only; the page shows the sentence for the code.
function bridgeCode(body: { error?: unknown } | null, status: number): AuthErrorCode {
  const raw = body?.error;
  console.error("[Auth] bridge refused the sign-in:", raw ?? `status ${status}`);
  return isAuthErrorCode(raw) && (BRIDGE_ERROR_CODES as readonly string[]).includes(raw) ? raw : "internal";
}

async function installSession(body: { access_token?: string; refresh_token?: string }): Promise<void> {
  if (body.access_token && body.refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (sessionError) throw sessionError;
  }
}

// The bridge is the one place that decides access, so it hears from every load
// of a legacy-portal tab: the Hub token, plus the access token of the session
// this browser already holds. It re-checks the Hub, writes the role and the
// company mapping, and answers with a new session only when the browser has
// none for this person.
async function bridgeHubSession(hubToken: string, accessToken: string | null): Promise<{ toolRole: UserRole; error?: AuthErrorCode }> {
  if (!SUPABASE_URL) return { toolRole: null, error: "not_configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hub-auth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hubToken, ...(accessToken ? { accessToken } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    // Dev only: this printed an auth payload to the console of every
    // production session, several times per page.
    if (body?.debug && import.meta.env.DEV) console.log("[Auth] bridge debug:", body.debug);
    if (!res.ok || body?.error) return { toolRole: null, error: bridgeCode(body, res.status) };
    await installSession(body);
    return { toolRole: (body.tool_role as UserRole) || null };
  } catch (err) {
    console.error("bridgeHubSession error:", err);
    return { toolRole: null, error: "unreachable" };
  }
}

// gOS (moburst.ai) exchange. Hands the single-use handoff token to the
// gos-auth-bridge edge function, which performs the server-side exchange and
// returns a Supabase session. On success the session is installed here.
async function bridgeGosSession(handoffToken: string): Promise<{ error?: AuthErrorCode }> {
  if (!SUPABASE_URL) return { error: "not_configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gos-auth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoffToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.debug && import.meta.env.DEV) console.log("[Auth] gos-bridge debug:", body.debug);
    if (!res.ok || body?.error) return { error: bridgeCode(body, res.status) };
    await installSession(body);
    return {};
  } catch (err) {
    console.error("bridgeGosSession error:", err);
    return { error: "unreachable" };
  }
}

// True when the session this browser holds, as the auth server verifies it,
// belongs to the person with this email. Any doubt is a no: a session that
// cannot be tied to the refused person is not ended here.
async function storedSessionIsFor(email: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return !error && String(data?.user?.email ?? "").toLowerCase() === email.toLowerCase();
  } catch {
    return false;
  }
}

const RETRIES = 3;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The stored session, or null when there is none. getSession refreshes an
// expired access token, and when the auth server does not answer it returns no
// session and an error while the session stays in storage. That is not a
// sign-out: retry, then throw so the caller says it could not reach the service.
async function storedSession() {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase.auth.getSession();
    if (!error) return data?.session ?? null;
    if (!isTransient(error)) return null;
    if (attempt >= RETRIES) throw error;
    await pause(250 * attempt);
  }
}

// Rebuild identity + role from an existing Supabase session, for any provenance.
//
// This used to bail unless user_metadata.auth_source === "gos", which was a
// deliberately narrow gate when gOS was added so the legacy path could not be
// disturbed. The side effect was that legacy tools.moburst.com users could not
// resume at all: their hub token lives in sessionStorage and dies with the tab,
// while the Supabase session sits in localStorage perfectly valid. Opening the
// tool in a new tab, or following a shared link, therefore demanded a fresh
// sign-in even though the user was signed in.
//
// Reconstruction now accepts any session that still resolves to a role. The
// role is read from user_roles, which is the authoritative source either way,
// so nothing is trusted that was not already trusted.
//
// isGosSession stays keyed strictly on auth_source, because it changes how
// client-side company scoping behaves and must not be inferred loosely.
export async function reconstructSession(): Promise<
  { user: HubUser; role: UserRole; isGos: boolean } | null
> {
  const session = await storedSession();
  if (!session) return null;
  // Only "no session" and a session the auth server rejects mean signed out.
  // A network or server failure is retried, then thrown: the person may well
  // still be signed in, and the caller must not say they are not.
  let su: { id: string; email?: string; created_at?: string; user_metadata?: unknown } | null = null;
  for (let attempt = 1; ; attempt++) {
    const { data: verified, error: verificationError } = await supabase.auth.getUser();
    if (!verificationError) { su = verified?.user ?? null; break; }
    if (!isTransient(verificationError)) return null;
    if (attempt >= RETRIES) throw verificationError;
    await pause(250 * attempt);
  }
  if (!su) return null;
  const meta = (su.user_metadata || {}) as Record<string, unknown>;
  const isGos = meta.auth_source === "gos";

  // Roles must come from the current database row, never cached metadata.
  let role: UserRole = null;
  let roleRows: Array<{ role: string }> | null = null;
  for (let attempt = 1; ; attempt++) {
    const { data, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", su.id);
    if (!roleError) { roleRows = data as Array<{ role: string }> | null; break; }
    if (attempt >= RETRIES) throw roleError;
    await pause(250 * attempt);
  }
  const roles = (roleRows || []).map((r) => r.role);
  role = strongestRole(roles);
  if (!role) return null;

  // Legacy sessions carry no hub_company_name in metadata, so read the profile.
  let company = (meta.hub_company_name as string) || "";
  if (!company) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("hub_company_name")
      .eq("user_id", su.id)
      .maybeSingle();
    company = (prof as { hub_company_name?: string } | null)?.hub_company_name || "";
  }

  const hubUser: HubUser = {
    _id: (meta.hub_user_id as string) || su.id,
    name: (meta.full_name as string) || su.email || "User",
    email: su.email || "",
    role,
    company,
    isActive: true,
    tools: [],
    createdAt: su.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { user: hubUser, role, isGos };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<AuthErrorCode | null>(null);
  const [isGosSession, setIsGosSession] = useState(false);
  const userRef = useRef<HubUser | null>(null);

  useEffect(() => {
    let unmounted = false;
    // Bumped by a sign-out event, so an in-flight sign-in that started before
    // it cannot restore the person. A later sign-in starts a new one.
    let generation = 0;
    let settled = false;

    const apply = (next: HubUser | null, role: UserRole, isGos: boolean) => {
      userRef.current = next;
      setUser(next);
      setUserRole(role);
      setIsGosSession(isGos);
    };

    async function authenticate() {
      const started = generation;
      const stale = () => unmounted || started !== generation;
      const finish = () => {
        settled = true;
        if (!stale()) setIsLoading(false);
      };

      // 0. gOS (moburst.ai) handoff. An explicit /auth/handoff?token means the user
      //    is arriving from moburst.ai; it wins over any stale legacy token in this
      //    tab. The single-use token is exchanged server-side, then we reload at "/"
      //    so we re-enter via the session path (2) on a clean, token-free URL.
      const gosToken = getGosHandoffToken();
      if (gosToken) {
        // Lets the portal deep-link straight to a page:
        //   /auth/handoff?token=...&next=/admin/usage
        // Guards cannot capture this, because /auth/handoff is not behind one.
        rememberIntendedDestination();
        clearHubToken(); // moburst.ai wins over any cached legacy-hub token
        const { error } = await bridgeGosSession(gosToken);
        if (unmounted) return;
        if (error) {
          // The sign-in page says why, in a sentence, with the way back.
          window.location.replace(`/auth?reason=${error}`);
        } else {
          rememberPortal("gos");
          window.location.replace("/"); // session set; reload on the branded host
        }
        return; // navigating away; leave isLoading as-is
      }

      // The reason sign-in did not happen, kept while a stored session gets its say.
      let failure: AuthErrorCode | null = null;
      const token = initHubToken();

      if (token) {
        let hubUser: HubUser | null = null;
        try {
          const hubRes = await fetch(`${HUB_API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (hubRes.ok) {
            hubUser = (await hubRes.json()) as HubUser;
          } else if (hubRes.status === 401 || hubRes.status === 403) {
            // The token is stale: drop it, so it does not block the stored session below.
            console.error(`Hub auth failed (${hubRes.status})`);
            clearHubToken();
            failure = "expired";
          } else {
            // The Hub could not answer (an outage or a rate limit). The token
            // is as good as before, so it stays for a retry in this tab.
            console.error(`Hub did not answer (${hubRes.status})`);
            failure = "unreachable";
          }
        } catch (err) {
          console.error("Authentication error:", err);
          failure = "unreachable";
        }
        if (stale()) return;

        if (hubUser) {
          // The bridge decides, on every load. The session this browser holds
          // goes with the request, so an unchanged person is answered ok with
          // no new session and a changed or removed one is dealt with there.
          let presented: string | null = null;
          try {
            presented = (await storedSession())?.access_token ?? null;
          } catch (err) {
            console.error("Session check error:", err);
          }
          if (stale()) return;
          const { toolRole, error } = await bridgeHubSession(token, presented);
          if (stale()) return;
          if (!error) {
            rememberPortal("hub");
            apply(hubUser, toolRole, false);
            setAuthError(null);
            finish();
            return;
          }
          if (isRefusal(error)) {
            // The Hub or the bridge said no. A stored session that is this
            // person's does not override that, and it ends here too (the
            // bridge has ended it on the server). Someone else's session in
            // this browser is left alone: only the Hub token goes.
            if (presented && (await storedSessionIsFor(hubUser.email))) {
              await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
            } else {
              clearHubToken();
            }
            if (unmounted) return;
            apply(null, null, false);
            setAuthError(error);
            finish();
            return;
          }
          failure = error;
        }
      }

      // 2. Any persisted Supabase session, from either portal. Rebuild identity
      //    and role without replaying a token, which cannot be replayed anyway:
      //    the gOS handoff token is single-use, and the legacy hub token lives
      //    in sessionStorage and dies with the tab. This is what lets a new tab
      //    or a shared link resume instead of demanding a fresh sign-in.
      try {
        const reconstructed = await reconstructSession();
        if (stale()) return;
        if (reconstructed) {
          rememberPortal(reconstructed.isGos ? "gos" : "hub");
          apply(reconstructed.user, reconstructed.role, reconstructed.isGos);
          setAuthError(null);
          finish();
          return;
        }
      } catch (err) {
        console.error("Session reconstruction error:", err);
        failure = failure ?? "unreachable";
      }

      // No Hub token. In Lovable preview, present a dev user so the UI renders
      // normally for layout work. Any existing persisted Supabase session in
      // localStorage (from a prior Hub-bridged sign-in on the same browser) will
      // continue to work and data will flow through RLS. If no such session
      // exists, queries return empty — that's expected, Lovable preview isn't
      // for data testing. Do NOT call any edge function here; a failed call
      // would surface as a Lovable runtime error toast.
      if (IS_LOVABLE_PREVIEW) {
        if (!stale()) apply(DEV_USER, "admin", false);
      }
      if (failure && !stale()) setAuthError(failure);
      finish();
    }

    // A person whose sign-out event came from another tab signs in again in
    // this one: without a rebuild the tab stays signed out until it is reloaded.
    async function recover() {
      const started = generation;
      try {
        const rebuilt = await reconstructSession();
        if (unmounted || started !== generation || userRef.current || !rebuilt) return;
        rememberPortal(rebuilt.isGos ? "gos" : "hub");
        apply(rebuilt.user, rebuilt.role, rebuilt.isGos);
        setAuthError(null);
        setIsLoading(false);
      } catch (err) {
        console.error("Session reconstruction error:", err);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !unmounted) {
        generation++; // Do not let in-flight reconstruction restore a signed-out user.
        settled = true;
        clearHubToken();
        apply(null, null, false);
        setAuthError("expired");
        setIsLoading(false);
      } else if (event === "SIGNED_IN" && settled && !userRef.current && !unmounted) {
        // Not inside the callback: supabase-js holds a lock while it runs.
        setTimeout(() => { void recover(); }, 0);
      }
    });
    authenticate();
    return () => {
      unmounted = true;
      subscription.unsubscribe();
    };
  }, []);

  const isAdmin = userRole === "admin";
  const isMoburstStaff = userRole === "admin" || userRole === "moburst_user";
  const isClient = userRole === "client";

  return (
    <AuthContext.Provider
      value={{
        user,
        userRole,
        isAdmin,
        isMoburstStaff,
        isClient,
        canDelete: isAdmin,
        canManageClients: isMoburstStaff,
        canRunAnalysis: isMoburstStaff,
        isLoading,
        isAuthenticated: !!user,
        authError,
        isGosSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
