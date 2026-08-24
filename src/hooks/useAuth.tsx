import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { initHubToken, clearHubToken } from "@/utils/hubAuth";
import { getGosHandoffToken, PORTAL_URL } from "@/utils/gosAuth";
import { rememberIntendedDestination } from "@/utils/returnTo";
import { supabase } from "@/integrations/supabase/client";

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
  name: "Dev User",
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
  authError: string | null;
  // True when the session came from gOS (moburst.ai). For gOS sessions, client
  // scoping is enforced by RLS via allowed_company_slugs, so the client-side
  // company-NAME filters (which only understand the legacy single-company model)
  // should defer to RLS instead of hiding rows.
  isGosSession: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function bridgeHubSession(
  hubToken: string,
): Promise<{ toolRole: UserRole; error?: string; debug?: unknown }> {
  if (!SUPABASE_URL) return { toolRole: null, error: "Supabase URL not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hub-auth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hubToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.debug) console.log("[Auth] bridge debug:", body.debug);
    if (!res.ok || body?.error) {
      return { toolRole: null, error: body?.error || `Bridge failed (${res.status})`, debug: body?.debug };
    }
    if (body.access_token && body.refresh_token) {
      await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
    }
    return { toolRole: (body.tool_role as UserRole) || null, debug: body?.debug };
  } catch (err) {
    console.error("bridgeHubSession error:", err);
    return { toolRole: null, error: "Could not reach auth bridge" };
  }
}

// gOS (moburst.ai) exchange. Hands the single-use handoff token to the
// gos-auth-bridge edge function, which performs the server-side exchange and
// returns a Supabase session. On success the session is installed here.
async function bridgeGosSession(handoffToken: string): Promise<{ error?: string }> {
  if (!SUPABASE_URL) return { error: "Supabase URL not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gos-auth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoffToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.debug) console.log("[Auth] gos-bridge debug:", body.debug);
    if (!res.ok || body?.error) return { error: body?.error || `Bridge failed (${res.status})` };
    if (body.access_token && body.refresh_token) {
      await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
    }
    return {};
  } catch (err) {
    console.error("bridgeGosSession error:", err);
    return { error: "Could not reach auth bridge" };
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
async function reconstructSession(): Promise<
  { user: HubUser; role: UserRole; isGos: boolean } | null
> {
  const { data: { session } } = await supabase.auth.getSession();
  const su = session?.user;
  if (!su) return null;
  const meta = (su.user_metadata || {}) as Record<string, unknown>;
  const isGos = meta.auth_source === "gos";

  // Role: prefer the authoritative DB row, fall back to session metadata.
  let role: UserRole = null;
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", su.id);
  const roles = (roleRows || []).map((r: { role: string }) => r.role);
  if (roles.includes("admin")) role = "admin";
  else if (roles.includes("moburst_user")) role = "moburst_user";
  else if (roles.includes("client")) role = "client";
  else if (typeof meta.tool_role === "string") role = meta.tool_role as UserRole;
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [isGosSession, setIsGosSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
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
        if (cancelled) return;
        if (error) {
          window.location.replace(PORTAL_URL); // fail closed → portal
        } else {
          window.location.replace("/"); // session set; reload on the branded host
        }
        return; // navigating away; leave isLoading as-is
      }

      const token = initHubToken();

      if (token) {
        try {
          const hubRes = await fetch(`${HUB_API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!hubRes.ok) throw new Error(`Hub auth failed (${hubRes.status})`);
          const hubUser = (await hubRes.json()) as HubUser;

          const { toolRole, error } = await bridgeHubSession(token);
          if (cancelled) return;

          if (error) {
            setUser(null);
            setUserRole(null);
            setAuthError(error);
          } else {
            setUser(hubUser);
            setUserRole(toolRole);
            setAuthError(null);
          }
        } catch (err) {
          console.error("Authentication error:", err);
          if (cancelled) return;
          setUser(null);
          setUserRole(null);
          setAuthError(err instanceof Error ? err.message : "Authentication failed");
        } finally {
          if (!cancelled) setIsLoading(false);
        }
        return;
      }

      // 2. Any persisted Supabase session, from either portal. Rebuild identity
      //    and role without replaying a token, which cannot be replayed anyway:
      //    the gOS handoff token is single-use, and the legacy hub token lives
      //    in sessionStorage and dies with the tab. This is what lets a new tab
      //    or a shared link resume instead of demanding a fresh sign-in.
      try {
        const reconstructed = await reconstructSession();
        if (cancelled) return;
        if (reconstructed) {
          setUser(reconstructed.user);
          setUserRole(reconstructed.role);
          setIsGosSession(reconstructed.isGos);
          setAuthError(null);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error("Session reconstruction error:", err);
      }

      // No Hub token. In Lovable preview, present a dev user so the UI renders
      // normally for layout work. Any existing persisted Supabase session in
      // localStorage (from a prior Hub-bridged sign-in on the same browser) will
      // continue to work and data will flow through RLS. If no such session
      // exists, queries return empty — that's expected, Lovable preview isn't
      // for data testing. Do NOT call any edge function here; a failed call
      // would surface as a Lovable runtime error toast.
      if (IS_LOVABLE_PREVIEW) {
        if (!cancelled) {
          setUser(DEV_USER);
          setUserRole("admin");
        }
      }
      if (!cancelled) setIsLoading(false);
    }

    authenticate();
    return () => {
      cancelled = true;
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
