import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Pencil } from "lucide-react";

// Admin-only panel that shows the Hub company name mapping for every tool client.
// Use this to align the tool's client records with the companies you create in the
// Moburst Hub admin panel. The bridge auto-maps Client-role users to all clients
// whose hub_company_name matches their Hub profile.company (case-insensitive).

export function HubCompanySync() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: clients, isLoading } = useQuery({
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

  const companyNames = Array.from(
    new Set(
      (clients || [])
        .map((c) => c.hub_company_name?.trim())
        .filter((n): n is string => !!n),
    ),
  ).sort();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(companyNames.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hub Company Mapping</CardTitle>
        <CardDescription>
          The bridge matches Client users to clients by their Hub company. Each tool client has a
          <code className="mx-1 text-xs bg-[rgba(255,255,255,0.05)] px-1 py-0.5 rounded">hub_company_name</code>
          that should match a company name in the Moburst Hub admin panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading clients…</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {companyNames.length} unique Hub company name{companyNames.length === 1 ? "" : "s"}. Copy this list
                and create matching companies in the Hub admin.
              </p>
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={companyNames.length === 0}>
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? "Copied" : "Copy list"}
              </Button>
            </div>

            <div className="rounded-lg border border-[rgba(255,255,255,0.06)] divide-y divide-[rgba(255,255,255,0.04)]">
              {(clients || []).map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{c.name}</p>
                    <p className="text-xs text-[#9ca3af]">Tool client</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingId === c.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          placeholder="Hub company name"
                          className="h-8 text-sm"
                          autoFocus
                        />
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
              ))}
              {(!clients || clients.length === 0) && (
                <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                  No clients yet.
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
