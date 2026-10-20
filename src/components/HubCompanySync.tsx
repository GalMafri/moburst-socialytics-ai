import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getHubToken } from "@/utils/hubAuth";
import { fetchActiveClients } from "@/lib/activeClients";
import { Section } from "@/components/ui/section";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Pencil, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

// Admin-only panel. Shows both sides of the mapping:
//   - "Hub Companies" — fetched live from https://tools-server.moburst.com/api/companies
//   - "Tool Clients" — each client with its hub_company_name, flagged if it doesn't
//     match any Hub company (typos, case drift, missing entries)
//
// The bridge auto-maps Client-role users to tool clients whose hub_company_name
// matches the user's Hub profile.company (case-insensitive). Getting this mapping
// right is the single most important setup step for Client-role visibility.

const HUB_BACKEND_URL = import.meta.env.VITE_HUB_BACKEND_URL || "https://tools-server.moburst.com";

interface HubCompany {
  _id: string;
  name: string;
}

export function HubCompanySync() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-hub-sync"],
    queryFn: async () => {
      // Active clients only, the one shared definition.
      return fetchActiveClients<{ id: string; name: string; hub_company_name: string | null }>("id, name, hub_company_name");
    },
  });

  const {
    data: hubCompanies,
    isLoading: hubLoading,
    error: hubError,
    refetch: refetchHub,
  } = useQuery({
    queryKey: ["hub-companies"],
    queryFn: async () => {
      const token = getHubToken();
      if (!token) throw new Error("Open Socialytics from the Moburst portal to see the portal's company list.");
      const res = await fetch(`${HUB_BACKEND_URL}/api/companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error("[hub companies]", res.status);
        throw new Error(res.status === 401 || res.status === 403 ? "The portal's company list is open to portal admins only." : "The portal's company list did not load. Reload the page to try again.");
      }
      return (await res.json()) as HubCompany[];
    },
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, hub_company_name }: { id: string; hub_company_name: string }) => {
      const { error } = await supabase
        .from("clients")
        .update({ hub_company_name: hub_company_name || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients-hub-sync"] });
      setEditingId(null);
      toast({ title: "Hub company name updated" });
    },
    onError: (err: Error) => {
      console.error("[hub company name]", err);
      toast({ title: "The company name was not saved", description: "Nothing changed. Try again in a minute.", variant: "destructive" });
    },
  });

  const hubCompanySet = useMemo(
    () => new Set((hubCompanies || []).map((c) => c.name.toLowerCase())),
    [hubCompanies],
  );

  const toolCompanyNames = useMemo(
    () =>
      Array.from(
        new Set(
          (clients || [])
            .map((c) => c.hub_company_name?.trim())
            .filter((n): n is string => !!n),
        ),
      ).sort(),
    [clients],
  );

  const missingInHub = useMemo(
    () => toolCompanyNames.filter((n) => hubCompanies && !hubCompanySet.has(n.toLowerCase())),
    [toolCompanyNames, hubCompanies, hubCompanySet],
  );

  const handleCopyMissing = async () => {
    await navigator.clipboard.writeText(missingInHub.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section
      layout="split"
      eyebrow="Portal access"
      title="Hub company mapping"
      description="Client users see the clients whose Hub company matches their own."
      action={
        <Button variant="outline" size="sm" onClick={() => refetchHub()} disabled={hubLoading}>
          <RefreshCw className={hubLoading ? "animate-spin" : ""} />
          Reload Hub companies
        </Button>
      }
    >
        {/* ── Hub companies side ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="t-h4">Hub companies</h3>
            <Badge variant="outline">
              {hubCompanies?.length ?? 0} from Hub
            </Badge>
          </div>
          {hubError ? (
            <p className="t-label !text-[rgb(248,113,113)] flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              {(hubError as Error).message}
            </p>
          ) : hubLoading ? (
            <Loading label="Loading from the Hub" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(hubCompanies || []).map((c) => (
                <span
                  key={c._id}
                  className="px-2.5 py-0.5 rounded-full t-label !text-[#b9e045] bg-[rgba(185,224,69,0.1)] border border-[rgba(185,224,69,0.25)]"
                >
                  {c.name}
                </span>
              ))}
              {(!hubCompanies || hubCompanies.length === 0) && (
                <p className="t-secondary">
                  No companies registered in the Hub yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Missing-in-Hub warning ── */}
        {missingInHub.length > 0 && hubCompanies && (
          <div className="rounded-[12px] border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.05)] p-inner space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="t-h4 !text-[#fbbf24] flex items-center gap-2">
                <AlertCircle className="h-4 w-4" aria-hidden />
                {missingInHub.length} client company name{missingInHub.length === 1 ? "" : "s"} not found in the Hub
              </p>
              <Button variant="outline" size="sm" onClick={handleCopyMissing}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy list"}
              </Button>
            </div>
            <p className="t-secondary">
              Create these in the Hub admin so Client users are matched to them automatically:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {missingInHub.map((n) => (
                <span key={n} className="px-2.5 py-0.5 rounded-full t-label bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)]">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Socialytics clients side ── */}
        <div className="space-y-2">
          <h3 className="t-h4">Socialytics clients</h3>
          {clientsLoading ? (
            <Loading label="Loading clients" />
          ) : (
            <div className="glass-inner divide-y divide-[rgba(255,255,255,0.05)]">
              {(clients || []).map((c) => {
                const matchesHub =
                  c.hub_company_name &&
                  hubCompanySet.has(c.hub_company_name.toLowerCase());
                return (
                  <div key={c.id} className="grid gap-x-4 gap-y-2 px-inner py-3 sm:grid-cols-2 sm:items-center">
                    <p className="t-body font-medium text-white truncate">{c.name}</p>
                    <div className="min-w-0">
                      {editingId === c.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            list={`hub-companies-${c.id}`}
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            placeholder="Hub company name"
                            aria-label={`Hub company name for ${c.name}`}
                            className="h-9 min-w-0 flex-1"
                            autoFocus
                          />
                          <datalist id={`hub-companies-${c.id}`}>
                            {(hubCompanies || []).map((hc) => (
                              <option key={hc._id} value={hc.name} />
                            ))}
                          </datalist>
                          <Button
                            size="sm"
                            onClick={() =>
                              updateMutation.mutate({ id: c.id, hub_company_name: editingValue.trim() })
                            }
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {c.hub_company_name ? (
                            matchesHub ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#b9e045] shrink-0" aria-label="Found in the Hub" />
                            ) : hubCompanies ? (
                              <AlertCircle className="h-3.5 w-3.5 text-[#fbbf24] shrink-0" aria-label="Not found in the Hub" />
                            ) : null
                          ) : null}
                          <span
                            className={`t-body ${
                              c.hub_company_name ? "text-white" : "text-[#b1b7c1]"
                            } truncate`}
                          >
                            {c.hub_company_name || "Not set"}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0"
                            aria-label={`Edit the hub company name for ${c.name}`}
                            onClick={() => {
                              setEditingId(c.id);
                              setEditingValue(c.hub_company_name || c.name);
                            }}
                          >
                            <Pencil aria-hidden />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {(!clients || clients.length === 0) && (
                <EmptyState compact framed={false} className="p-inner" title="No clients yet" />
              )}
            </div>
          )}
        </div>
    </Section>
  );
}
