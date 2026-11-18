/**
 * Around every page at /clients/:id/... (18 Nov 2026): when this person
 * cannot read the client, the page says so in one calm sentence, with the way
 * back to their dashboard, in place of a page that waits for figures that
 * will never come.
 *
 * A client can't be read when row access returns no row for it (a client
 * user opening another client's address, or an id that does not exist), when
 * the id is not an id at all, or, for a client's own user, when the client
 * is archived (their dashboard no longer lists it). Staff keep an archived
 * client's pages: the dashboard's archive view opens its setup, reports and
 * analytics, and its calendar is read-only.
 *
 * A read that fails (no answer) closes nothing: the page is shown and keeps
 * its own way to try again. The page is mounted from the start, so its own
 * reads are not delayed, and is shown once the answer is known.
 */

import type { ReactNode } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DEV_USER_ID, useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";

export const CLIENT_NOT_AVAILABLE = "This client isn't available to you";
export const CLIENT_NOT_AVAILABLE_NEXT = "Your dashboard has the clients you can open.";

/** The id the new-client form uses; there is no client to read yet. */
const NEW_CLIENT = "new";

/** Postgres's answer to an id that is not a uuid: a definite "no such client", not a failed read. */
const NOT_AN_ID = "22P02";

type Access = "open" | "closed";

export function ClientNotAvailable() {
  return (
    <AppLayout title="Client">
      <EmptyState
        icon={Compass}
        title={CLIENT_NOT_AVAILABLE}
        description={CLIENT_NOT_AVAILABLE_NEXT}
        action={<Button asChild size="sm"><Link to="/">Go to your dashboard</Link></Button>}
      />
    </AppLayout>
  );
}

/** The gate itself, for any children; the routes use it as a layout around `<Outlet />`. */
export function ClientAccessGate({ children }: { children?: ReactNode }) {
  const { id } = useParams();
  const { user, userRole, isMoburstStaff, isLoading: signingIn, isAuthenticated } = useAuth();
  const content = children ?? <Outlet />;
  // Before sign-in has finished, a read answers for nobody: the page's own layout signs in first.
  // The editor preview's stand-in user has no database session, so its read would answer "no row"
  // for every client; its pages are shown as they always were.
  const enabled = !!id && id !== NEW_CLIENT && !signingIn && isAuthenticated && user?._id !== DEV_USER_ID;
  const access = useQuery({
    // Read again when the viewer changes, a staff member previewing as a client included.
    queryKey: ["client-access", id, user?._id ?? null, userRole ?? null],
    enabled,
    retry: false,
    queryFn: async (): Promise<Access> => {
      const { data, error } = await supabase.from("clients").select("id, archived_at").eq("id", id!).maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === NOT_AN_ID) return "closed";
        throw error;
      }
      if (!data) return "closed";
      if ((data as { archived_at?: string | null }).archived_at && !isMoburstStaff) return "closed";
      return "open";
    },
  });

  if (enabled && access.data === "closed") return <ClientNotAvailable />;
  // One shape whatever the state, so the page is never built a second time when sign-in finishes or ends.
  const waiting = enabled && access.isPending && !access.isError;
  return (
    <>
      {waiting && (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loading variant="page" label="Loading" />
        </div>
      )}
      <div style={{ display: waiting ? "none" : "contents" }}>{content}</div>
    </>
  );
}
