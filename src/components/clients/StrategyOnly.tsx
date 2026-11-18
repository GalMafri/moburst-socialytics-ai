/**
 * What a strategy-only client's closed screens show (18 Nov 2026): one calm
 * sentence in place of the content, with the way to its strategy and, for
 * staff, its setup. A client with no active account in Sprout gets its
 * strategy; its calendar, designs, analytics and reports open by themselves
 * once an account is connected (src/lib/strategyOnly.ts).
 *
 * The Strategy page and the setup page are staff pages, so their links are
 * shown to staff only. A client's own user reads the same sentence without
 * the name Sprout, which only staff see.
 */

import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Compass, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { strategyOnlyLead, strategyOnlyOpens, useStrategyOnlyClients } from "@/lib/strategyOnly";

/** The links a notice carries, for staff: the client's strategy, then its setup (left out where the screen already offers it). */
export function StrategyOnlyLinks({ clientId, setup = true }: { clientId: string; setup?: boolean }) {
  return (
    <>
      <Button asChild size="sm"><Link to={`/clients/${clientId}/strategy`}><Compass /> Open the strategy</Link></Button>
      {setup && <Button asChild size="sm" variant="outline"><Link to={`/clients/${clientId}/setup`}><Settings /> Client setup</Link></Button>}
    </>
  );
}

/**
 * The sentence, as an empty state. `clientName` saves the read when the
 * screen already has it; `compact` is the form for inside a card, and
 * `setupLink={false}` is for a card that has its own way to the setup page.
 */
export function StrategyOnlyNotice({ clientId, clientName, compact = false, setupLink = true }: { clientId: string; clientName?: string | null; compact?: boolean; setupLink?: boolean }) {
  const { isMoburstStaff } = useAuth();
  const named = useQuery({
    queryKey: ["strategy-only-name", clientId],
    enabled: clientName === undefined,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
      if (error) throw error;
      return (data?.name as string | null | undefined) ?? null;
    },
  });
  return (
    <EmptyState
      icon={Compass}
      compact={compact}
      title={strategyOnlyLead(clientName ?? named.data)}
      description={strategyOnlyOpens(!!isMoburstStaff)}
      action={isMoburstStaff ? <StrategyOnlyLinks clientId={clientId} setup={setupLink} /> : undefined}
    />
  );
}

/**
 * Around a client's Calendar, Analytics and Reports pages: the page for a
 * client in Sprout, the sentence for a strategy-only one. The page is mounted
 * from the start, so its own reads run as they always did, and is only shown
 * once the client's state is known; for a strategy-only client it is taken
 * away and the sentence stands in its place. A state that cannot be read
 * closes nothing.
 */
export function StrategyOnlyGate({ title, children }: { title: string; children: ReactNode }) {
  const { id } = useParams();
  const only = useStrategyOnlyClients();
  if (!only.isLoading && id && only.has(id)) {
    return (
      <AppLayout title={title}>
        <StrategyOnlyNotice clientId={id} />
      </AppLayout>
    );
  }
  return (
    <>
      {only.isLoading && (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loading variant="page" label="Loading" />
        </div>
      )}
      <div style={{ display: only.isLoading ? "none" : "contents" }}>{children}</div>
    </>
  );
}
