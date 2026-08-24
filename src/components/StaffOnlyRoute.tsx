import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { rememberIntendedDestination } from "@/utils/returnTo";

// Wraps a route so only Moburst staff (admin or moburst_user) can render it.
// Client-role users are redirected to the dashboard, where ClientDashboard shows
// only their company's data.

export function StaffOnlyRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isMoburstStaff } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0c10]">
        <div className="animate-pulse text-[#9ca3af]">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) {
  // Remember where they were headed so the portal round trip can finish the
  // journey instead of dumping them on the dashboard.
    rememberIntendedDestination();
    return <Navigate to="/auth" replace />;
  }
  if (!isMoburstStaff) return <Navigate to="/" replace />;

  return <>{children}</>;
}
