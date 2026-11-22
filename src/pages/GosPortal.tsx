// gOS portal redirect routes: /login, /portal, /logout.
//
// Per the gOS integration guide, tools don't run their own login page — users
// authenticate on the portal. These routes simply bounce to the branded portal.
// /logout also tears down the local Supabase session and any legacy hub token.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { portalUrl } from "@/utils/gosAuth";
import { clearHubToken } from "@/utils/hubAuth";

export const PortalRedirect = () => {
  useEffect(() => {
    window.location.replace(portalUrl());
  }, []);
  return null;
};

export const Logout = () => {
  useEffect(() => {
    (async () => {
      // Read before sign-out so the link goes back to the portal they used.
      const destination = portalUrl();
      try {
        clearHubToken();
        // QA 22 Nov 2026 (P20-5): a global sign-out whose request does not get
        // through keeps the stored session, and the next visit would resume it.
        // The local sign-out always removes it from this device.
        const { error } = await supabase.auth.signOut().catch((e: unknown) => ({ error: e }));
        if (error) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      } finally {
        window.location.replace(destination);
      }
    })();
  }, []);
  return null;
};
