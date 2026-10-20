import { ClientPicker } from "@/components/clients/ClientPicker";
import { ClientOverview } from "@/components/dashboard/ClientOverview";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
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
import { isActiveClient } from "@/lib/activeClients";
import { formatDate } from "@/lib/display";
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
    onError: (err: any) => { console.error("[archive client]", err); toast.error("The client was not archived. Try again in a minute."); },
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
    onError: (err: any) => { console.error("[restore client]", err); toast.error("The client was not restored. Try again in a minute."); },
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
    onError: (err: any) => { console.error("[delete client]", err); toast.error("The client was not deleted. Try again in a minute."); },
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

  // The dashboard is the one screen that shows the archive, on request. The
  // active list uses the shared definition every other client list uses.
  const filtered = clients?.filter((c: any) => {
    const matchesSearch = c.name.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (showArchived ? !isActiveClient(c) : isActiveClient(c));
  });

  const selectedClient = filtered?.find(c => c.id === params.get("client")) || filtered?.[0];
  const chooseClient = (id: string) => setParams(prev => { prev.set("client", id); return prev; }, { replace: true });

  const active = (clients ?? []).filter(isActiveClient);
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
          <>
            <Button
              variant={showArchived ? "secondary" : "outline"}
              onClick={() => setShowArchived(!showArchived)}
              aria-pressed={showArchived}
            >
              <Archive />
              {showArchived ? "Show active" : "Show archived"}
            </Button>
            {canManageClients && (
              <Button onClick={() => navigate("/clients/new/setup")}>
                <Plus /> Add client
              </Button>
            )}
          </>
        }
      />

      {/* A failed load leaves `clients` undefined, and every tile below counts
          off it. Rendering them would put four confident zeros on the staff
          landing page for an agency with a full roster. */}
      {!isLoading && !clientsFailed && (
        <StatGrid>
          <StatCard label="Active clients" value={active.length} icon={<Users />} />
          <StatCard label="Completed reports" value={completedReports} icon={<BarChart3 />} />
          <StatCard label="Reports this month" value={reportsThisMonth} icon={<Calendar />} />
          <StatCard label="Running now" value={runningNow} icon={<Play />} sub={runningNow ? "analysis in progress" : undefined} />
        </StatGrid>
      )}

      {clientsFailed ? (
        <LoadError
          title="Could not load the clients"
          error={clientsError}
          onRetry={() => refetchClients()}
        />
      ) : isLoading ? (
        // The same two columns the loaded page has, so nothing jumps when it lands.
        <div className="grid gap-section lg:grid-cols-[260px_minmax(0,1fr)]">
          {[0, 1].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="space-y-3">
                <div className="h-5 bg-[rgba(255,255,255,0.04)] rounded w-1/2" />
                <div className="h-4 bg-[rgba(255,255,255,0.04)] rounded w-3/4" />
                <div className="h-4 bg-[rgba(255,255,255,0.04)] rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clients && clients.length > 0 ? (
        <div className="grid gap-section lg:grid-cols-[260px_minmax(0,1fr)] items-start">
          <ClientPicker clients={filtered || []} selectedId={selectedClient?.id} onSelect={chooseClient} search={search} onSearch={setSearch} />
          <div className="min-w-0">
          {!selectedClient && <EmptyState icon={Users} title={search ? "No client by that name" : showArchived ? "No archived clients" : "No active clients"} description={search ? "Try another client name." : undefined} />}
          {(selectedClient ? [selectedClient] : []).map((client: any) => {
            // PostgREST returns an embedded resource in no particular order, so
            // pick the newest row here rather than trusting reports[0].
            const lastReport = (client.reports ?? []).reduce(
              (newest: any, r: any) => (!newest || new Date(r.created_at) > new Date(newest.created_at) ? r : newest),
              null,
            );
            const reportCount = client.reports?.length ?? 0;
            return (
              <Card key={client.id}>
                <CardHeader className="border-b border-white/10">
                  <p className="t-subhead">Selected client</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {client.logo_url && <img src={client.logo_url} alt="" className="h-10 w-10 rounded-[8px] object-cover shrink-0" />}
                    <div className="flex flex-wrap items-center gap-2 min-w-[12rem] flex-1">
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
                        <Badge variant="secondary">Archived</Badge>
                      )}
                      {(client as any).demo_job_id && (
                        <Badge variant="outline" title="Created by an API demo; it can be removed from the demo job">Demo</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canRunAnalysis && !client.archived_at && (
                        <Button size="sm" onClick={() => navigate(`/clients/${client.id}/analyze`)}>
                          <Play /> Run monthly report
                        </Button>
                      )}
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="More actions">
                              <MoreVertical />
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
                                  <Trash2 className="h-4 w-4 mr-2" /> Permanently delete
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem onClick={() => setArchiving({ id: client.id, name: client.name })}>
                                <Archive className="h-4 w-4 mr-2" /> Archive client
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-card">
                  {/* The client's status at a glance, with what needs doing. */}
                  {!client.archived_at && <ClientOverview clientId={client.id} isStaff />}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 t-label">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" aria-hidden />
                      {lastReport ? `Last report ${formatDate(lastReport.created_at)}` : "No reports yet"}
                      {reportCount > 0 ? ` · ${reportCount} report${reportCount === 1 ? "" : "s"}` : ""}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {client.primary_platforms?.slice(0, 3).map((p: string) => (
                        <PlatformBadge key={p} platform={p} size="sm" />
                      ))}
                    </span>
                  </div>
                  {/* Straight to this client's work, as one even row of
                      equal buttons rather than a ragged wrap of seven. */}
                  <nav aria-label={`${client.name} pages`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/setup`)}><Settings /> Edit client</Button>
                    {canRunAnalysis && !client.archived_at && <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/competitive`)}><Crosshair /> Edit competitors</Button>}
                    {canRunAnalysis && !client.archived_at && <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/competitive/run`)}><Play /> Run competitive report</Button>}
                    <Button size="sm" variant="outline" aria-label="Monthly reports" onClick={() => navigate(`/clients/${client.id}/reports`)}><FileText /> Reports</Button>
                    <Button size="sm" variant="outline" aria-label="Competitive analyses" onClick={() => navigate(`/clients/${client.id}/competitive/reports`)}><Crosshair /> Competitive reports</Button>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${client.id}/analytics`)}><BarChart3 /> Analytics</Button>
                  </nav>
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
                <Plus /> Add client
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
              posts, and uploaded files will be deleted. Type the
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
