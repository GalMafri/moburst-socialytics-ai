import { useMemo, useState, type FormEvent } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { PersonalKeyError, useCreatePersonalKey, usePersonalKeys, useRevokePersonalKey, type NewPersonalKey } from "@/hooks/usePersonalKeys";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/useApiKeys";
import { fetchActiveClients } from "@/lib/activeClients";
import { KEY_SCOPES } from "@/lib/api-scopes";
import { formatDate } from "@/lib/display";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { cn } from "@/lib/utils";

/**
 * The Tokens tab of the API page: one card, one table, one Create token
 * dialog. Every Moburst staff member sees and makes their own keys (read only
 * or read and write, for all their companies or some, at most 90 days, the
 * api function's /v1/me/keys); admins also see the tool keys (not tied to a
 * person, for gOS and the moburst.ai portal, any scope including costs) in the
 * same table and make them from the same dialog (/v1/admin/keys).
 */

/** Active keys a person may hold at once, and the longest one lasts (the api function's /v1/me/keys limits). */
const ACTIVE_LIMIT = 10;
const LIFETIME_DAYS = 90;
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type Status = "active" | "expired" | "revoked";
interface Row {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  tool: boolean;
  companies: string[] | null;
  createdBy: string | null;
  createdAt: string;
  lastUsed: string | null;
  expires: string | null;
  revoked: string | null;
}

function statusOf(r: Row, now = Date.now()): Status {
  if (r.revoked) return "revoked";
  if (r.expires && new Date(r.expires).getTime() <= now) return "expired";
  return "active";
}

/** How a key's access reads: Read-only, Read & write, or a tool key's own list. */
export function scopeLabel(scopes: string[], tool = false): string {
  if (tool) return scopes.join(", ");
  return scopes.includes("run") ? "Read & write" : "Read-only";
}

const STATUS: Record<Status, { label: string; className: string }> = {
  active: { label: "Active", className: "border-transparent bg-success/15 text-success" },
  revoked: { label: "Revoked", className: "border-transparent bg-destructive/20 text-destructive" },
  expired: { label: "Expired", className: "border-transparent bg-warning/15 text-warning" },
};

/** What the dialog says when a key is not made: the server's own sentence for a refusal written for the person, else where it stands. */
function notMadeLine(error: unknown): string {
  if (error instanceof PersonalKeyError && (error.status === 400 || error.status === 409)) return error.message;
  return "No key yet. The name you typed is kept.";
}
/** A personal create is sent again only when the server provably did no work: a rate limit (429) or a service not up (503). */
const createResendable = (error: unknown) => error instanceof PersonalKeyError && (error.status === 429 || error.status === 503);
/** No reply, or a gateway's reply: the key may have been made and its reply lost. Never sent again; the list is read again instead. */
function unconfirmed(error: unknown): boolean {
  if (error instanceof PersonalKeyError) return error.status === 502 || error.status === 504;
  return error != null;
}
const UNCONFIRMED_LINE = "The new key is not confirmed yet. Check your keys below before making another.";

type Created = { name: string; key: string; scopes: string[]; expires_at: string | null; tool: boolean };

function OneTimeKey({ created, onDone }: { created: Created; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const until = formatDate(created.expires_at);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch (e) {
      console.warn("[api key] copy to clipboard", e);
      setCopied(false);
    }
  };
  const what = created.tool ? "It is a tool key, not tied to a person" : created.scopes.includes("run") ? "It sees what you see in Socialytics and can start work for you" : "It sees what you see in Socialytics and is read only";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{created.name} is ready</DialogTitle>
        <DialogDescription>{until ? `${what}, and stops working on ${until}.` : `${what}.`}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3" data-testid="key-created">
        <div className="flex items-center gap-2">
          <code className="input-glass min-w-0 flex-1 break-all rounded-xl px-3 py-2 font-mono text-[13px] text-primary">{created.key}</code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="t-label">Copy this key now. You won't see it again.</p>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    </>
  );
}

function CreateTokenDialog({ open, onOpenChange, onUnconfirmed }: { open: boolean; onOpenChange: (open: boolean) => void; onUnconfirmed: () => void }) {
  const { isAdmin } = useAuth();
  const personal = useCreatePersonalKey();
  const tool = useCreateApiKey();
  const [name, setName] = useState("");
  const [isTool, setIsTool] = useState(false);
  const [write, setWrite] = useState(false);
  const [toolScopes, setToolScopes] = useState<string[]>(["read"]);
  const [allCompanies, setAllCompanies] = useState(true);
  const [companies, setCompanies] = useState<string[]>([]);
  const [ends, setEnds] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  // Held across the quiet resends, so the key is not asked for twice in the meantime.
  const [sending, setSending] = useState(false);
  // The companies the person can see (row access follows RLS), read only while the dialog is open.
  const { data: slugs = [] } = useQuery({
    queryKey: ["token-companies"],
    queryFn: async () => {
      const rows = await fetchActiveClients<{ company_slug: string | null }>("company_slug");
      return Array.from(new Set(rows.map((c) => c.company_slug).filter((x): x is string => !!x))).sort();
    },
    enabled: open,
    retry: false,
  });

  // Closing forgets everything, the key above all: once the dialog is shut the key exists nowhere on this screen.
  const close = () => {
    setCreated(null);
    setName("");
    setIsTool(false);
    setWrite(false);
    setToolScopes(["read"]);
    setAllCompanies(true);
    setCompanies([]);
    setEnds("");
    setLine(null);
    personal.reset();
    tool.reset();
    onOpenChange(false);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || sending) return;
    if (!allCompanies && !companies.length) { setLine("Choose at least one company, or all companies."); return; }
    if (isTool && !toolScopes.length) { setLine("Choose what the tool key may do."); return; }
    setLine(null);
    setSending(true);
    // The end of the day picked; none picked is the longest a key may last.
    const expires = ends ? new Date(`${ends}T23:59:59`).toISOString() : null;
    if (isTool) {
      const input = { name: name.trim(), scopes: KEY_SCOPES.map((s) => s.id).filter((s) => toolScopes.includes(s)), company_slugs: allCompanies ? [] : companies, expires_at: expires };
      // A new key each time, so it is sent again only when it never reached the server.
      const { data, error } = await sendQuietly(() => tool.mutateAsync(input).then((d) => ({ data: d, error: null }), (err: unknown) => ({ data: null, error: err })));
      setSending(false);
      if (error || !data) {
        console.warn("[api key] tool key not made yet", error);
        setLine("No key yet. The name you typed is kept.");
        return;
      }
      tool.reset();
      setCreated({ name: data.name, key: data.key, scopes: data.scopes, expires_at: data.expires_at, tool: true });
      return;
    }
    const input: NewPersonalKey = { name: name.trim(), scopes: write ? ["read", "run"] : ["read"], company_slugs: allCompanies ? null : companies, expires_at: expires };
    const { data, error } = await sendQuietly(
      () => personal.mutateAsync(input).then((d) => ({ data: d, error: null }), (err: unknown) => ({ data: null, error: err })),
      { again: createResendable },
    );
    setSending(false);
    if (error || !data) {
      console.warn("[api key] not made yet", error);
      if (unconfirmed(error)) {
        // The list is the truth: the page reads it again and says to look there first.
        close();
        onUnconfirmed();
        return;
      }
      setLine(notMadeLine(error));
      return;
    }
    // The key now lives only in this dialog's state.
    personal.reset();
    setCreated({ name: data.name, key: data.key, scopes: data.scopes, expires_at: data.expires_at, tool: false });
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    // Kept open while a key is being made, and while the key is shown only Done closes it.
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !sending && !created && close())}>
      <DialogContent
        className={cn("max-w-lg", created && "[&>button]:hidden")}
        onInteractOutside={(e) => { if (created) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (created) e.preventDefault(); }}
      >
        {created ? (
          <OneTimeKey created={created} onDone={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create token</DialogTitle>
              <DialogDescription>Name it after where you will use it. The key is shown once, when it is made.</DialogDescription>
            </DialogHeader>
            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input id="token-name" placeholder="For example, Weekly report script" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Checkbox id="token-tool" checked={isTool} onCheckedChange={(v) => setIsTool(v === true)} />
                  <Label htmlFor="token-tool" className="text-[13px]">Tool key (not tied to a person)</Label>
                </div>
              )}
              {isTool ? (
                <fieldset className="space-y-2">
                  <legend className="t-label">What the key may do</legend>
                  {KEY_SCOPES.map((s) => (
                    <div key={s.id} className="flex items-start gap-2">
                      <Checkbox id={`token-scope-${s.id}`} checked={toolScopes.includes(s.id)} onCheckedChange={() => setToolScopes(toggle(toolScopes, s.id))} className="mt-0.5" />
                      <div>
                        <Label htmlFor={`token-scope-${s.id}`} className="text-[13px] font-medium">{s.label}</Label>
                        <p className="t-label">{s.hint}</p>
                      </div>
                    </div>
                  ))}
                </fieldset>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="t-label">Access</legend>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={write ? "outline" : "default"} aria-pressed={!write} onClick={() => setWrite(false)}>Read-only</Button>
                    <Button type="button" size="sm" variant={write ? "default" : "outline"} aria-pressed={write} onClick={() => setWrite(true)}>Read & write</Button>
                  </div>
                  <p className="t-label">{write ? "Reads, and starts work for you: reports, drafts, designs, competitor updates and calendar weeks, charged to the client." : "Reads what you see in Socialytics."}</p>
                </fieldset>
              )}
              <fieldset className="space-y-2">
                <legend className="t-label">Companies</legend>
                <div className="flex items-center gap-2">
                  <Checkbox id="token-all" checked={allCompanies} onCheckedChange={(v) => setAllCompanies(v === true)} />
                  <Label htmlFor="token-all" className="text-[13px]">All companies</Label>
                </div>
                {!allCompanies && (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {slugs.length === 0 ? <p className="t-label">No companies to choose from yet.</p> : slugs.map((slug) => (
                      <div key={slug} className="flex items-center gap-2">
                        <Checkbox id={`token-company-${slug}`} checked={companies.includes(slug)} onCheckedChange={() => setCompanies(toggle(companies, slug))} />
                        <Label htmlFor={`token-company-${slug}`} className="text-[13px]">{slug}</Label>
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="token-ends">Expires</Label>
                <Input id="token-ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} min={dayFromNow(1)} max={isTool ? undefined : dayFromNow(LIFETIME_DAYS)} />
                <p className="t-label">{isTool ? "Leave it empty for a key that does not expire." : `Leave it empty for the longest, ${LIFETIME_DAYS} days.`}</p>
              </div>
              {line && <p role="status" className="t-secondary">{line}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close} disabled={sending}>Cancel</Button>
                <Button type="submit" disabled={!name.trim() || sending}>Create</Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TokensCard() {
  const { isMoburstStaff, isAdmin, user } = useAuth();
  const mine = usePersonalKeys(isMoburstStaff);
  const tools = useApiKeys(isAdmin);
  const revokePersonal = useRevokePersonalKey();
  const revokeTool = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [toRevoke, setToRevoke] = useState<Row | null>(null);
  /** One quiet line over the table: a key not revoked yet, or a new key that could not be confirmed. */
  const [notice, setNotice] = useState<string | null>(null);
  const me = user?.email || user?.name || null;

  const rows = useMemo<Row[]>(() => {
    const own = (mine.data ?? []).map((k): Row => ({ id: k.id, name: k.name, prefix: k.key_prefix, scopes: k.scopes, tool: false, companies: k.company_slugs ?? null, createdBy: me, createdAt: k.created_at, lastUsed: k.last_used_at, expires: k.expires_at, revoked: k.revoked_at }));
    const toolRows = isAdmin ? (tools.data ?? []).filter((k) => !k.owner_user_id).map((k): Row => ({ id: k.id, name: k.name, prefix: k.key_prefix, scopes: k.scopes, tool: true, companies: k.company_slugs?.length ? k.company_slugs : null, createdBy: k.created_by_email ?? null, createdAt: k.created_at, lastUsed: k.last_used_at, expires: k.expires_at, revoked: k.revoked_at })) : [];
    return [...own, ...toolRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [mine.data, tools.data, isAdmin, me]);
  const loaded = !mine.isLoading && !mine.isError;
  const active = (mine.data ?? []).filter((k) => !k.revoked_at && !(k.expires_at && new Date(k.expires_at).getTime() <= Date.now())).length;

  const confirmRevoke = async (r: Row) => {
    setToRevoke(null);
    setNotice(null);
    // Revoking twice answers the first revoke, so a send that failed on the server is safe to repeat.
    const send = () => (r.tool ? revokeTool.mutateAsync(r.id) : revokePersonal.mutateAsync(r.id)).then(() => ({ error: null }), (e: unknown) => ({ error: e }));
    const { error: notDone } = await sendQuietly(send, { again: (e) => invokeResendable(e, { idempotent: true }) });
    if (notDone) {
      console.warn("[api key] not revoked yet", notDone);
      setNotice(`${r.name} is not revoked yet.`);
      void mine.refetch();
      if (isAdmin) void tools.refetch();
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Tokens</CardTitle>
          <p className="t-secondary">Each key sees what you see here, is read only unless you choose read and write, and lasts up to 90 days.{loaded ? ` ${active} of ${ACTIVE_LIMIT} active.` : ""}</p>
        </div>
        <Button onClick={() => { setNotice(null); setCreating(true); }}>
          <Plus aria-hidden />
          Create token
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && <p role="status" className="t-secondary">{notice}</p>}
        {mine.isLoading ? (
          <Loading label="Loading your keys" />
        ) : mine.isError ? (
          // Not the same as having no keys: it keeps loading and tries again on its own.
          <LoadRetry context="api keys" error={mine.error} label="Loading your keys" onRetry={() => mine.refetch()} />
        ) : rows.length === 0 ? (
          <div className="space-y-1"><p className="t-h4">No keys yet</p><p className="t-secondary">Create one to use Socialytics from your own tools, scripts and agents.</p></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const status = statusOf(r);
                return (
                  <TableRow key={`${r.tool ? "t" : "p"}-${r.id}`} data-key-row={r.name} className={cn(status !== "active" && "opacity-70")}>
                    <TableCell className="font-medium text-white">{r.name}</TableCell>
                    <TableCell className="font-mono t-label">{r.prefix}…</TableCell>
                    <TableCell>{r.tool ? <span><Badge variant="outline">Tool key</Badge> <span className="t-label">{scopeLabel(r.scopes, true)}</span></span> : scopeLabel(r.scopes)}</TableCell>
                    <TableCell>{r.companies?.length ? r.companies.join(", ") : "All companies"}</TableCell>
                    <TableCell>
                      <div>{r.createdBy ?? "Unknown"}</div>
                      <div className="t-label">{formatDate(r.createdAt)}</div>
                    </TableCell>
                    <TableCell>{r.lastUsed ? formatDate(r.lastUsed) : "Never"}</TableCell>
                    <TableCell>{r.expires ? formatDate(r.expires) : "Never"}</TableCell>
                    <TableCell><Badge className={STATUS[status].className} data-state-badge>{STATUS[status].label}</Badge></TableCell>
                    <TableCell className="text-right">
                      {status === "active" && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setToRevoke(r)} aria-label={`Revoke ${r.name}`}>
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CreateTokenDialog open={creating} onOpenChange={setCreating} onUnconfirmed={() => { setNotice(UNCONFIRMED_LINE); void mine.refetch(); }} />
      <AlertDialog open={!!toRevoke} onOpenChange={(o) => !o && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {toRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Anything using this key stops working right away. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toRevoke) void confirmRevoke(toRevoke); }}>Yes, revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
