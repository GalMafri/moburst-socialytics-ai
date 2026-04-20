import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { initHubToken } from "@/utils/hubAuth";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
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
