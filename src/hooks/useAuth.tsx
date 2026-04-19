import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { initHubToken } from "@/utils/hubAuth";
import { supabase } from "@/integrations/supabase/client";

const HUB_API_URL = import.meta.env.VITE_HUB_BACKEND_URL || "https://tools-server.moburst.com";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// In Lovable preview (or localhost dev) we may have no hubToken. If a persisted
// Supabase session exists from a prior email/password signup, the data will still
// load — we just present the dev user for UI context.
const IS_DEV =
  import.meta.env.DEV ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname.includes("lovable.app") ||
  window.location.hostname === "localhost";

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
  isMoburstStaff: boolean; // admin OR moburst_user
  isClient: boolean;
  canDelete: boolean;       // admin only
  canManageClients: boolean; // admin OR moburst_user
  canRunAnalysis: boolean;   // admin OR moburst_user
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function bridgeHubSession(hubToken: string): Promise<{ toolRole: UserRole; error?: string }> {
  if (!SUPABASE_URL) return { toolRole: null, error: "Supabase URL not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hub-auth-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hubToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { toolRole: null, error: body?.error || `Bridge failed (${res.status})` };
    }
    if (body.access_token && body.refresh_token) {
      await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
    }
    return { toolRole: (body.tool_role as UserRole) || null };
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
          // 1. Fetch the Hub user (source of truth for identity + tool assignment)
          const hubRes = await fetch(`${HUB_API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!hubRes.ok) throw new Error(`Hub auth failed (${hubRes.status})`);
          const hubUser = (await hubRes.json()) as HubUser;

          // 2. Bridge to Supabase: mints a session and syncs role + company mapping
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
          if (IS_DEV) {
            console.warn("[Auth] Hub unreachable — falling back to dev user");
            setUser(DEV_USER);
            setUserRole("admin");
          } else {
            setUser(null);
            setUserRole(null);
            setAuthError(err instanceof Error ? err.message : "Authentication failed");
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
        return;
      }

      // No Hub token. Dev mode: use dev user. Prod: stay unauthenticated.
      if (IS_DEV) {
        console.warn("[Auth] No hubToken — using dev user (preview/localhost only)");
        setUser(DEV_USER);
        setUserRole("admin");
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
