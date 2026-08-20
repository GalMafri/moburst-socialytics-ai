import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// Wraps a route so only admins can render it. Stricter than StaffOnlyRoute,
// which also admits moburst_user. Everyone else goes to the dashboard.
// This is a convenience guard, not the security boundary: the data behind
// /usage is gated in Postgres by is_admin() inside get_user_analytics().

export function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0c10]">
        <div className="animate-pulse text-[#9ca3af]">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
