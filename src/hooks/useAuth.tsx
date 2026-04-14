import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { initHubToken } from "@/utils/hubAuth";

const HUB_API_URL = import.meta.env.VITE_HUB_BACKEND_URL || "https://tools-server.moburst.com";
const IS_DEV =
  import.meta.env.DEV ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname.includes("lovable.app");

const SOCIALYTICS_URL = "https://socialytics.moburst.com/";

export interface HubUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  company: string;
  isActive: boolean;
  tools: Array<{ tool: { _id: string; name: string; url?: string }; role: string }>;
  createdAt: string;
  updatedAt: string;
}

// Dev-only fallback user so you can still use the app in Lovable / localhost
const DEV_USER: HubUser = {
  _id: "00000000-0000-0000-0000-000000000000",
  name: "Dev User",
  email: "dev@localhost",
  role: "admin",
  company: "Dev",
  isActive: true,
  tools: [{ tool: { _id: "dev", name: "Socialytics", url: SOCIALYTICS_URL }, role: "Admin" }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export type UserRole = "Admin" | "Moburst User" | "Client" | null;

/**
 * Derive the user's Socialytics-specific role from the tools array.
 * Falls back to the top-level `role` field mapped to the closest UserRole,
 * and ultimately to null if nothing matches.
 */
function deriveSocialyticsRole(hubUser: HubUser): UserRole {
  const socialyticsTool = hubUser.tools?.find(
    (t) => t.tool?.url?.replace(/\/$/, "") === SOCIALYTICS_URL.replace(/\/$/, "")
  );

  const toolRole = socialyticsTool?.role;

  if (toolRole === "Admin" || toolRole === "Moburst User" || toolRole === "Client") {
    return toolRole;
  }

  // Fallback: map top-level role
  if (hubUser.role === "admin") return "Admin";
  if (hubUser.role === "user") return "Moburst User";

  return null;
}

interface AuthContextType {
  user: HubUser | null;
  userRole: UserRole;
  isAdmin: boolean;
  isMoburstUser: boolean;
  isClient: boolean;
  canDelete: boolean;
  canManageClients: boolean;
  canRunAnalysis: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = initHubToken();

    if (token) {
      fetch(`${HUB_API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Auth failed");
          return res.json();
        })
        .then((hubUser: HubUser) => {
          setUser(hubUser);
        })
        .catch((err) => {
          console.error("Hub auth failed:", err);
          if (IS_DEV) {
            console.warn("Falling back to dev user");
            setUser(DEV_USER);
          } else {
            setUser(null);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
      return;
    }

    if (IS_DEV) {
      console.warn("[Auth] No hubToken found — using dev user (dev mode only)");
      setUser(DEV_USER);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, []);

  const userRole: UserRole = user ? deriveSocialyticsRole(user) : null;
  const isAdmin = userRole === "Admin";
  const isMoburstUser = userRole === "Moburst User";
  const isClient = userRole === "Client";
  const canDelete = isAdmin;
  const canManageClients = isAdmin || isMoburstUser;
  const canRunAnalysis = isAdmin || isMoburstUser;
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{
      user, userRole,
      isAdmin, isMoburstUser, isClient,
      canDelete, canManageClients, canRunAnalysis,
      isLoading, isAuthenticated,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
