import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { rememberIntendedDestination } from "@/utils/returnTo";

// Wraps a route so only admins can render it. Stricter than StaffOnlyRoute,
// which also admits moburst_user. Everyone else goes to the dashboard.
// This is a convenience guard, not the security boundary: the data behind
// /usage is gated in Postgres by is_admin() inside get_user_analytics().

export function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0c10]">
        <div className="animate-pulse text-[#b1b7c1]">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) {
  // Remember where they were headed so the portal round trip can finish the
  // journey instead of dumping them on the dashboard.
    rememberIntendedDestination();
    return <Navigate to="/auth" replace />;
  }
  if (!isAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
