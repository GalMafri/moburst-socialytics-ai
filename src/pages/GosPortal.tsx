// gOS portal redirect routes: /login, /portal, /logout.
//
// Per the gOS integration guide, tools don't run their own login page — users
// authenticate on the portal. These routes simply bounce to the branded portal.
// /logout also tears down the local Supabase session and any legacy hub token.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_URL } from "@/utils/gosAuth";
import { clearHubToken } from "@/utils/hubAuth";

export const PortalRedirect = () => {
  useEffect(() => {
    window.location.replace(PORTAL_URL);
  }, []);
  return null;
};

export const Logout = () => {
  useEffect(() => {
    (async () => {
      try {
        clearHubToken();
        await supabase.auth.signOut();
      } finally {
        window.location.replace(PORTAL_URL);
      }
    })();
  }, []);
  return null;
};
