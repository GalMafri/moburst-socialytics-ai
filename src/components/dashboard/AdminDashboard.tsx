import { ClientPicker } from "@/components/clients/ClientPicker";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Loading } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Play, Calendar, BarChart3, MoreVertical, Archive, RotateCcw, Trash2, Crosshair, Users, Settings, FileText } from "lucide-react";
import { PlatformBadge } from "@/lib/platform-config";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";

export function AdminDashboard() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { canManageClients, canRunAnalysis, canDelete } = useAuth();
  const [search, setSearch] = useState("");
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const archiveMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: new Date().toISOString() } as any)
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client archived");
    },
    onError: (err: any) => toast.error("Failed to archive: " + err.message),
  });

  const restoreMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: null } as any)
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client restored");
    },
    onError: (err: any) => toast.error("Failed to restore: " + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.functions.invoke("delete-client", {
        body: { client_id: clientId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client permanently deleted");
    },
    onError: (err: any) => toast.error("Failed to delete: " + err.message),
  });

  // Realtime: listen for any report changes to refresh dashboard
  useEffect(() => {
    const channel = supabase
      .channel("admin-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => {
        queryClient.invalidateQueries({ queryKey: ["clients"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: clients, isLoading, isError: clientsFailed, error: clientsError, refetch: refetchClients } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*, reports(id, status, created_at)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = clients?.filter((c: any) => {
    const matchesSearch = c.name.toLowerCase().includes(search.trim().toLowerCase());
    const isArchived = !!(c as any).archived_at;
    return matchesSearch && (showArchived ? isArchived : !isArchived);
  });

  const selectedClient = filtered?.find(c => c.id === params.get("client")) || filtered?.[0];
  const chooseClient = (id: string) => setParams(prev => { prev.set("client", id); return prev; }, { replace: true });

  const active = (clients ?? []).filter((c: any) => !c.archived_at);
  const allReports = (clients ?? []).flatMap((c: any) => c.reports ?? []);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const reportsThisMonth = allReports.filter((r: any) => new Date(r.created_at) >= monthStart).length;
  const runningNow = allReports.filter((r: any) => r.status === "running").length;
  const completedReports = allReports.filter((r: any) => r.status === "completed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={
          clientsFailed
            ? "The client list could not be loaded, so nothing below is the real roster."
            : `${active.length} active ${active.length === 1 ? "client" : "clients"}. Choose a client below to edit its setup, manage competitors or run a report.`
        }
        actions={
          canManageClients ? (
            <Button onClick={() => navigate("/clients/new/setup")}>
              <Plus className="h-4 w-4 mr-2" /> Add client
            </Button>
          ) : undefined
        }
      />

      {/* A failed load leaves `clients` undefined, and every tile below counts
          off it. Rendering them would put four confident zeros on the staff
          landing page for an agency with a full roster. */}
      {!isLoading && !clientsFailed && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 stagger-children">
          <StatCard label="Active clients" value={active.length} icon={<Users className="h-3.5 w-3.5" />} />
          <StatCard label="Completed reports" value={completedReports} icon={<BarChart3 className="h-3.5 w-3.5" />} />
          <StatCard label="Reports this month" value={reportsThisMonth} icon={<Calendar className="h-3.5 w-3.5" />} />
          <StatCard label="Running now" value={runningNow} icon={<Play className="h-3.5 w-3.5" />} sub={runningNow ? "analysis in progress" : undefined} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant={showArchived ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive className="h-3 w-3 mr-1" />
          {showArchived ? "Show Active" : "Show archived"}
        </Button>
      </div>

      {clientsFailed ? (
        <LoadError
          title="Could not load the clients"
          error={clientsError}
          onRetry={() => refetchClients()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 bg-[rgba(255,255,255,0.04)] rounded w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-[rgba(255,255,255,0.04)] rounded w-3/4 mb-2" />
                <div className="h-4 bg-[rgba(255,255,255,0.04)] rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clients && clients.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ClientPicker clients={filtered || []} selectedId={selectedClient?.id} onSelect={chooseClient} search={search} onSearch={setSearch} />
          <div className="min-w-0">
          {!selectedClient && <p className="t-secondary py-6">{search ? "Try another client name." : showArchived ? "No archived clients." : "No active clients."}</p>}
          {(selectedClient ? [selectedClient] : []).map((client: any) => {
            // PostgREST returns an embedded resource in no particular order, so
            // pick the newest row here rather than trusting reports[0].
            const lastReport = (client.reports ?? []).reduce(
              (newest: any, r: any) => (!newest || new Date(r.created_at) > new Date(newest.created_at) ? r : newest),
              null,
            );
            const reportCount = client.reports?.length ?? 0;
            return (
              <Card key={client.id} className="border-white/15">
                <CardHeader className="pb-4 border-b border-white/10">
                  <p className="t-label uppercase tracking-wider">Selected client</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* The name opens setup. The card itself is no longer a
                          control: a button wrapping five other buttons is a
                          control inside a control, and screen readers and the
                          Tab key both lose track of which one they are on. */}
                      <CardTitle className="t-h2">
                        <button
                          type="button"
                          onClick={() => navigate(`/clients/${client.id}/setup`)}
                          aria-label={`Open ${client.name} setup`}
                          className="text-left hover:underline underline-offset-4 decoration-[rgba(255,255,255,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-[6px]"
                        >
                          {client.name}
                        </button>
                      </CardTitle>
                      {(client as any).archived_at && (
                        <Badge variant="secondary" className="t-label">Archived</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {client.logo_url && <img src={client.logo_url} alt="" className="h-8 w-8 rounded object-cover" />}
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label="More actions">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canRunAnalysis && (
                              <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}/competitive`)}>
                                <Crosshair className="h-4 w-4 mr-2" /> Competitive analysis
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}/setup`)}>
                              <Settings className="h-4 w-4 mr-2" /> Client setup
                            </DropdownMenuItem>
                            {canDelete && ((client as any).archived_at ? (
                              <>
                                <DropdownMenuItem onClick={() => restoreMutation.mutate(client.id)}>
                                  <RotateCcw className="h-4 w-4 mr-2" /> Restore
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => {
                                    setDeleteTarget({ id: client.id, name: client.name });
                                    setDeleteConfirmText("");
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" /> Permanently Delete
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem onClick={() => setArchiving({ id: client.id, name: client.name })}>
                                <Archive className="h-4 w-4 mr-2" /> Archive Client
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                  <div className="flex items-center gap-2 t-secondary">
                    <Calendar className="h-3.5 w-3.5" />
                    {lastReport
                      ? `Last report: ${new Date(lastReport.created_at).toLocaleDateString()}`
                      : "No reports yet"}
                  </div>
                  <div className="flex items-center gap-2 t-secondary">
                    {client.primary_platforms?.slice(0, 3).map((p: string) => (
                      <PlatformBadge key={p} platform={p} size="sm" />
                    ))}
                  </div>
                  <div className="space-y-2 pt-2">
                    <span className="t-secondary whitespace-nowrap">{reportCount} report{reportCount === 1 ? "" : "s"}</span>
                    {/* Straight to this client's work: the two report shelves,
                        the analytics view, and a new run. */}
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/setup`)}><Settings className="h-3.5 w-3.5 mr-1.5" /> Edit client</Button>
                      {canRunAnalysis && !client.archived_at && <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/competitive`)}><Crosshair className="h-3.5 w-3.5 mr-1.5" /> Edit competitors</Button>}
                      {canRunAnalysis && !client.archived_at && <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/competitive/run`)}><Play className="h-3.5 w-3.5 mr-1.5" /> Run competitive report</Button>}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3"
                        title="Monthly reports"
                        aria-label="Monthly reports"
                        onClick={() => {
                          navigate(`/clients/${client.id}/reports`);
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" /><span className="ml-1.5">Reports</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3"
                        title="Competitive analyses"
                        aria-label="Competitive analyses"
                        onClick={() => {
                          navigate(`/clients/${client.id}/competitive/reports`);
                        }}
                      >
                        <Crosshair className="h-3.5 w-3.5" /><span className="ml-1.5">Competitive reports</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3"
                        title="Analytics"
                        aria-label="Analytics"
                        onClick={() => {
                          navigate(`/clients/${client.id}/analytics`);
                        }}
                      >
                        <BarChart3 className="h-3.5 w-3.5" /><span className="ml-1.5">Analytics</span>
                      </Button>
                      {canRunAnalysis && (
                        <>
                          <Button
                            size="sm"
                            className="h-9 px-3"
                            title="Run monthly report"
                            aria-label="Run monthly report"
                            onClick={() => {
                              navigate(`/clients/${client.id}/analyze`);
                            }}
                          >
                            <Play className="h-3.5 w-3.5" /><span className="ml-1.5">Run monthly report</span>
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Plus}
          title={canManageClients ? "Add your first client" : "No clients yet"}
          description={canManageClients ? "Get started by creating a client configuration." : "No clients have been configured yet."}
          action={
            canManageClients ? (
              <Button onClick={() => navigate("/clients/new/setup")}>
                <Plus className="h-4 w-4 mr-2" /> Add client
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Permanent delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this client?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The client, all of its reports, scheduled
              posts, and uploaded files will be deleted from Supabase. Type the
              client name below to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-name" className="t-body">
              Confirm by typing <span className="font-mono">{deleteTarget?.name}</span>
            </Label>
            <Input
              id="confirm-name"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget?.name}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmText !== deleteTarget?.name}
              onClick={() => {
                if (deleteTarget && deleteConfirmText === deleteTarget.name) {
                  deleteMutation.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                  setDeleteConfirmText("");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Permanently delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? "this client"}?`}
        description={
          <>
            <p>The client comes off the dashboard and stops being scheduled. Reports, designs and competitor sets stay.</p>
            <p className="t-secondary">You can bring an archived client back at any time.</p>
          </>
        }
        confirmLabel="Archive client"
        destructive={false}
        onConfirm={() => {
          if (archiving) archiveMutation.mutate(archiving.id);
          setArchiving(null);
        }}
      />
    </div>
  );
}
