import { useState } from "react";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useApiKeys, useCreateApiKey, useRevokeApiKey, type ApiKey, type CreatedKey } from "@/hooks/useApiKeys";
import { cn } from "@/lib/utils";

const SCOPES: Array<{ id: "read" | "demo" | "admin"; label: string; hint: string }> = [
  { id: "read", label: "read", hint: "Every client, report, competitor set, post, schedule and alert the key may see." },
  { id: "demo", label: "demo", hint: "Onboard a brand and run every feature for it." },
  { id: "admin", label: "admin", hint: "Manage keys through the API." },
];

const relative = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : null);

function ScopeChips({ scopes }: { scopes: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} variant={s === "admin" ? "default" : "secondary"} className="text-[11px] font-bold tracking-[-0.2px]">
          {s}
        </Badge>
      ))}
    </span>
  );
}

function KeyRow({ k, onRevoke }: { k: ApiKey; onRevoke: (k: ApiKey) => void }) {
  const reach = k.company_slugs?.length ? k.company_slugs : k.client_ids?.length ? [`${k.client_ids.length} client${k.client_ids.length === 1 ? "" : "s"}`] : null;
  return (
    <li className={cn("glass-inner flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", k.revoked_at && "opacity-50")}>
      <div className="min-w-[140px] flex-1">
        <p className="text-[14px] font-medium tracking-[-0.5px] text-white">{k.name}</p>
        <p className="mt-0.5 font-mono text-[12px] text-white/50">{k.key_prefix}…</p>
      </div>
      <ScopeChips scopes={k.scopes} />
      <span className="flex flex-wrap gap-1">
        {reach ? reach.map((r) => (
          <Badge key={r} variant="outline" className="text-[11px] font-medium">
            {r}
          </Badge>
        )) : (
          <Badge variant="outline" className="text-[11px] font-medium">All clients</Badge>
        )}
      </span>
      <p className="min-w-[120px] text-[12px] text-[#9ca3af]">
        {k.revoked_at ? `Revoked ${relative(k.revoked_at)}` : k.last_used_at ? `Last used ${relative(k.last_used_at)}` : "Never used"}
      </p>
      {!k.revoked_at && (
        <Button variant="ghost" size="sm" onClick={() => onRevoke(k)} aria-label={`Revoke ${k.name}`}>
          Revoke
        </Button>
      )}
    </li>
  );
}

function OneTimeKey({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="glass-accent space-y-3 p-4" data-testid="api-key-created">
      <p className="text-[14px] font-medium tracking-[-0.5px] text-white">{created.name} is ready.</p>
      <div className="flex items-center gap-2">
        <code className="input-glass flex-1 truncate rounded-xl px-3 py-2 font-mono text-[13px] text-[#d7f07a]">{created.key}</code>
        <Button size="sm" variant="outline" onClick={copy} aria-label="Copy key">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
      <p className="text-[12px] text-[#9ca3af]">Copy it now; it is not shown again.</p>
      <Button size="sm" variant="secondary" onClick={onDone}>Done</Button>
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange, clientSlugs, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; clientSlugs: string[]; onCreated: (k: CreatedKey) => void }) {
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [slugs, setSlugs] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = async () => {
    setError(null);
    try {
      const created = await create.mutateAsync({ name: name.trim(), scopes: SCOPES.map((s) => s.id).filter((s) => scopes.includes(s)), company_slugs: slugs, expires_at: expires ? new Date(expires).toISOString() : null });
      setName("");
      setScopes(["read"]);
      setSlugs([]);
      setExpires("");
      onCreated(created);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The key could not be created.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>For gOS or another Moburst tool. The key is shown once, when it is created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="api-key-name">Name</Label>
            <Input id="api-key-name" placeholder="e.g. gOS production" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <p className="text-[12px] font-medium tracking-[0.1px] text-[#9ca3af]">What the key may do</p>
            <ul className="space-y-2">
              {SCOPES.map((s) => (
                <li key={s.id} className="glass-inner flex items-start gap-3 px-3 py-2">
                  <Checkbox id={`api-scope-${s.id}`} checked={scopes.includes(s.id)} onCheckedChange={() => setScopes(toggle(scopes, s.id))} className="mt-0.5" />
                  <div>
                    <Label htmlFor={`api-scope-${s.id}`} className="text-[13px] font-medium">{s.label}</Label>
                    <p className="text-[12px] text-[#9ca3af]">{s.hint}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-[12px] font-medium tracking-[0.1px] text-[#9ca3af]">Which clients it may see</p>
            <p className="text-[12px] text-white/60">{slugs.length ? `${slugs.length} selected` : "All clients, unless you pick some."}</p>
            <div className="flex flex-wrap gap-1.5">
              {clientSlugs.map((slug) => {
                const on = slugs.includes(slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSlugs(toggle(slugs, slug))}
                    className={cn("rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors", on ? "border-[rgba(185,224,69,0.45)] bg-[rgba(185,224,69,0.14)] text-[#d7f07a]" : "border-white/[0.12] text-white/70 hover:bg-white/[0.06]")}
                  >
                    {slug}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-expires">Expires (optional)</Label>
            <Input id="api-key-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="max-w-[200px]" />
          </div>
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!name.trim() || scopes.length === 0 || create.isPending}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Keys for gOS and other Moburst tools: who holds one, what it may do, and a way to make or revoke one. Admins only. */
export function ApiAccessCard({ clientSlugs }: { clientSlugs: string[] }) {
  const { isAdmin } = useAuth();
  const { data: keys = [], isLoading } = useApiKeys(isAdmin);
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  if (!isAdmin) return null;
  const live = keys.filter((k) => !k.revoked_at);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="glass-inner flex h-[64px] min-w-[72px] flex-col items-center justify-center px-3" aria-label={`${live.length} keys in use`}>
              <span className="text-[30px] font-bold leading-[36px] tracking-[-0.5px] text-white" data-testid="api-keys-count">{live.length}</span>
              <span className="text-[11px] uppercase tracking-wider text-[#9ca3af]">in use</span>
            </div>
            <div>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#b9e045]" aria-hidden />API access</CardTitle>
              <CardDescription>Keys let gOS and other Moburst tools read this workspace and start demos.</CardDescription>
            </div>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Create key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {created && <OneTimeKey created={created} onDone={() => setCreated(null)} />}
        {isLoading ? (
          <p className="text-[13px] text-[#9ca3af]">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-[13px] text-[#9ca3af]">No keys yet. Create one for gOS or another Moburst tool.</p>
        ) : (
          <ul className="space-y-2">
            {keys.map((k) => (
              <KeyRow key={k.id} k={k} onRevoke={setToRevoke} />
            ))}
          </ul>
        )}
      </CardContent>
      <CreateKeyDialog open={creating} onOpenChange={setCreating} clientSlugs={clientSlugs} onCreated={setCreated} />
      <AlertDialog open={!!toRevoke} onOpenChange={(o) => !o && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {toRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Every call made with this key stops working right away. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toRevoke) revoke.mutate(toRevoke.id); setToRevoke(null); }}>Yes, revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
