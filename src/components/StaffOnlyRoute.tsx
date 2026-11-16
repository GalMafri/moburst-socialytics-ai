import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { RedirectToSignIn, SigningIn } from "@/components/RedirectToSignIn";
import { useAuth } from "@/hooks/useAuth";

// Wraps a route so only Moburst staff (admin or moburst_user) can render it.
// Client-role users are redirected to the dashboard, where ClientDashboard shows
// only their company's data.

export function StaffOnlyRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isMoburstStaff } = useAuth();

  if (isLoading) return <SigningIn />;
  if (!isAuthenticated) return <RedirectToSignIn />;
  if (!isMoburstStaff) return <Navigate to="/" replace />;

  return <>{children}</>;
}
