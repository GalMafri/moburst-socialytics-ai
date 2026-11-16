// Landing page for the gOS (moburst.ai) handoff at /auth/handoff?token=...
//
// The actual token exchange runs in useAuth (AuthProvider) so all auth logic lives
// in one place. This page just shows the shared signing-in screen while that
// happens; on success useAuth does a full-page redirect to "/", on failure to the
// portal. If a user lands here without a token, we bounce them to the portal.
import { useEffect } from "react";
import { SigningIn } from "@/components/RedirectToSignIn";
import { portalUrl, getGosHandoffToken } from "@/utils/gosAuth";

const AuthHandoff = () => {
  useEffect(() => {
    if (!getGosHandoffToken()) {
      window.location.replace(portalUrl());
    }
  }, []);

  return <SigningIn />;
};

export default AuthHandoff;
