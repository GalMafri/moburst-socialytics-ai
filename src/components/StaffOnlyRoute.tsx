import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

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
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  if (!isMoburstStaff) return <Navigate to="/" replace />;

  return <>{children}</>;
}
