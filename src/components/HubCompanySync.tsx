import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getHubToken } from "@/utils/hubAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, hub_company_name")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; hub_company_name: string | null }>;
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
      if (!token) throw new Error("No Hub token in session (open from Hub, not directly)");
      const res = await fetch(`${HUB_BACKEND_URL}/api/companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Hub /api/companies returned ${res.status} (admin required)`);
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
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Hub Company Mapping</CardTitle>
            <CardDescription>
              The bridge matches Client users to clients by their Hub company.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchHub()} disabled={hubLoading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${hubLoading ? "animate-spin" : ""}`} />
            Reload Hub companies
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Hub companies side ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Hub Companies</h4>
            <Badge variant="outline" className="text-[10px]">
              {hubCompanies?.length ?? 0} from Hub
            </Badge>
          </div>
          {hubError ? (
            <p className="text-xs text-[#ef4444] flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {(hubError as Error).message}
            </p>
          ) : hubLoading ? (
            <p className="text-xs text-muted-foreground">Loading from Hub…</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(hubCompanies || []).map((c) => (
                <span
                  key={c._id}
                  className="px-2 py-0.5 rounded text-xs bg-[rgba(185,224,69,0.1)] text-[#b9e045] border border-[rgba(185,224,69,0.25)]"
                >
                  {c.name}
                </span>
              ))}
              {(!hubCompanies || hubCompanies.length === 0) && (
                <p className="text-xs text-muted-foreground italic">
                  No companies registered in the Hub yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Missing-in-Hub warning ── */}
        {missingInHub.length > 0 && hubCompanies && (
          <div className="rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.05)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#fbbf24] font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {missingInHub.length} tool company name{missingInHub.length === 1 ? "" : "s"} not found in Hub
              </p>
              <Button variant="outline" size="sm" onClick={handleCopyMissing}>
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? "Copied" : "Copy list"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create these in the Hub admin so Client users can be auto-mapped:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {missingInHub.map((n) => (
                <span key={n} className="px-2 py-0.5 rounded text-xs bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)]">
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Tool clients side ── */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Tool Clients</h4>
          {clientsLoading ? (
            <p className="text-sm text-muted-foreground">Loading clients…</p>
          ) : (
            <div className="rounded-lg border border-[rgba(255,255,255,0.06)] divide-y divide-[rgba(255,255,255,0.04)]">
              {(clients || []).map((c) => {
                const matchesHub =
                  c.hub_company_name &&
                  hubCompanySet.has(c.hub_company_name.toLowerCase());
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{c.name}</p>
                      <p className="text-xs text-[#9ca3af]">Tool client</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            list={`hub-companies-${c.id}`}
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            placeholder="Hub company name"
                            className="h-8 text-sm"
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
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#b9e045] shrink-0" />
                            ) : hubCompanies ? (
                              <AlertCircle className="h-3.5 w-3.5 text-[#fbbf24] shrink-0" />
                            ) : null
                          ) : null}
                          <span
                            className={`text-sm ${
                              c.hub_company_name ? "text-white" : "italic text-[#6b7280]"
                            } truncate`}
                          >
                            {c.hub_company_name || "— not set —"}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => {
                              setEditingId(c.id);
                              setEditingValue(c.hub_company_name || c.name);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {(!clients || clients.length === 0) && (
                <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                  No clients yet.
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
