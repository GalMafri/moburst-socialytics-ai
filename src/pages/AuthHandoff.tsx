// Landing page for the gOS (moburst.ai) handoff at /auth/handoff?token=...
//
// The actual token exchange runs in useAuth (AuthProvider) so all auth logic lives
// in one place. This page just shows a brief "signing you in" state while that
// happens; on success useAuth does a full-page redirect to "/", on failure to the
// portal. If a user lands here without a token, we bounce them to the portal.
import { useEffect } from "react";
import { PORTAL_URL, getGosHandoffToken } from "@/utils/gosAuth";

const AuthHandoff = () => {
  useEffect(() => {
    if (!getGosHandoffToken()) {
      window.location.replace(PORTAL_URL);
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
};

export default AuthHandoff;
