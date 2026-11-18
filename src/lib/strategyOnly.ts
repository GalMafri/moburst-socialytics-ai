/**
 * Strategy-only clients, for the screens (18 Nov 2026). A client with no
 * active account in Sprout gets its strategy; its calendar, designs,
 * analytics and reports are closed until an account is connected, and open
 * by themselves when one is. The state is never stored: the database works
 * it out from the client's accounts (strategy_only_clients, the one
 * definition the server's jobs and actions read too;
 * supabase/functions/_shared/sprout/strategyOnly.ts).
 *
 * One read for every screen: the ids of the strategy-only clients this
 * viewer can see. It is read again each time a screen opens, so a client
 * whose accounts were just connected opens on the next page. A read that
 * does not answer closes nothing: the screens show what they always showed.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { strategyOnlyClients } from "../../supabase/functions/_shared/sprout/strategyOnly.ts";

export { STRATEGY_ONLY_OPENS, STRATEGY_ONLY_OPENS_STAFF, STRATEGY_ONLY_SHORT, STRATEGY_ONLY_SHORT_STAFF, strategyOnlyLead, strategyOnlyOpens, strategyOnlySentence, strategyOnlyShort } from "../../supabase/functions/_shared/sprout/strategyOnly.ts";

const NONE: ReadonlySet<string> = new Set<string>();

export interface StrategyOnlyClients {
  /** True until the read has answered, or has failed, for this viewer. */
  isLoading: boolean;
  /** The strategy-only clients this viewer can see; empty when the read did not answer. */
  ids: ReadonlySet<string>;
  /** True when the client is known to be strategy-only. */
  has(clientId: string | null | undefined): boolean;
}

export function useStrategyOnlyClients(): StrategyOnlyClients {
  const { user } = useAuth();
  const query = useQuery({
    // Read again when the viewer changes: a read made before sign-in finished says nothing about this viewer.
    queryKey: ["strategy-only-clients", user?._id ?? null],
    queryFn: () => strategyOnlyClients(supabase),
    retry: false,
  });
  // Only a set the read itself returned counts: anything else closes nothing.
  const ids = query.data instanceof Set ? (query.data as ReadonlySet<string>) : NONE;
  return { isLoading: query.isLoading, ids, has: (clientId) => !!clientId && ids.has(clientId) };
}
