import { useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { PersonalKeyError, useCreatePersonalKey, usePersonalKeys, useRevokePersonalKey, type CreatedPersonalKey, type PersonalKey } from "@/hooks/usePersonalKeys";
import { formatDate } from "@/lib/display";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { cn } from "@/lib/utils";

/** Active keys a person may hold at once (the api function's /v1/me/keys limit). */
const ACTIVE_LIMIT = 10;

type KeyState = "active" | "expired" | "revoked";

function stateOf(k: PersonalKey, now = Date.now()): KeyState {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= now) return "expired";
  return "active";
}

/**
 * What the screen says when a key is not made. The server's own sentence for
 * a name it refused (400) and for the active-key limit (409), which are
 * written for the person; for anything else, where the key stands. The
 * server's text for the rest goes to the console only.
 */
function notMadeLine(error: unknown): string {
  if (error instanceof PersonalKeyError && (error.status === 400 || error.status === 409)) return error.message;
  return "No key yet. The name you typed is kept.";
}

function KeyRow({ k, onRevoke }: { k: PersonalKey; onRevoke: (k: PersonalKey) => void }) {
  const state = stateOf(k);
  return (
    <li className={cn("glass-inner flex flex-wrap items-center gap-x-6 gap-y-2 p-inner", state !== "active" && "opacity-60")}>
      <div className="min-w-[180px] flex-1">
        <p className="t-h4">{k.name}</p>
        <p className="mt-0.5 t-label">Starts with {k.key_prefix}…</p>
      </div>
      {/* Fixed widths from sm up, so the dates and the button line up down the list. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 t-label sm:[&>span]:w-[150px]">
        <span>Created {formatDate(k.created_at)}</span>
        {state === "revoked" ? (
          <span>Revoked {formatDate(k.revoked_at)}</span>
        ) : k.expires_at ? (
          <span>{state === "expired" ? "Expired" : "Expires"} {formatDate(k.expires_at)}</span>
        ) : null}
        <span>{k.last_used_at ? `Last used ${formatDate(k.last_used_at)}` : "Never used"}</span>
      </div>
      <div className="flex sm:w-[88px] sm:justify-end">
        {state === "active" ? (
          <Button variant="ghost" size="sm" onClick={() => onRevoke(k)} aria-label={`Revoke ${k.name}`}>
            Revoke
          </Button>
        ) : (
          <Badge variant="outline" data-state-badge>{state === "revoked" ? "Revoked" : "Expired"}</Badge>
        )}
      </div>
    </li>
  );
}

function OneTimeKey({ created, onDone }: { created: CreatedPersonalKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch (e) {
      // The key stays on screen to select by hand.
      console.warn("[personal api key] copy to clipboard", e);
      setCopied(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{created.name} is ready</DialogTitle>
        <DialogDescription>
          It sees what you see in Socialytics, is read only, and stops working on {formatDate(created.expires_at)}.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3" data-testid="personal-key-created">
        <div className="flex items-center gap-2">
          <code className="input-glass min-w-0 flex-1 break-all rounded-xl px-3 py-2 font-mono text-[13px] text-[#d7f07a]">{created.key}</code>
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

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreatePersonalKey();
  const [name, setName] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPersonalKey | null>(null);
  // Held across the quiet resends, so the key is not asked for twice in the meantime.
  const [sending, setSending] = useState(false);

  // Closing forgets everything, the key above all: once the dialog is shut the
  // key exists nowhere on this screen.
  const close = () => {
    setCreated(null);
    setName("");
    setLine(null);
    create.reset();
    onOpenChange(false);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || sending) return;
    setLine(null);
    setSending(true);
    // Sent again quietly only when it never reached the server: each send makes a new key.
    const { data, error } = await sendQuietly(() => create.mutateAsync(name.trim()).then((data) => ({ data, error: null }), (error: unknown) => ({ data: null, error })));
    setSending(false);
    if (error || !data) {
      console.warn("[personal api key] not made yet", error);
      setLine(notMadeLine(error));
      return;
    }
    // The key now lives only in this dialog's state.
    create.reset();
    setCreated(data);
  };

  return (
    // Kept open while a key is being made, so a key made after a close is never shown on the next open.
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !sending && close())}>
      <DialogContent
        className="max-w-lg"
        // A stray click outside must not lose a key that is shown only once.
        onInteractOutside={(e) => { if (created) e.preventDefault(); }}
      >
        {created ? (
          <OneTimeKey created={created} onDone={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>Name it after where you will use it, so you can tell your keys apart.</DialogDescription>
            </DialogHeader>
            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="personal-key-name">Name</Label>
                <Input id="personal-key-name" placeholder="For example, Weekly report script" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
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

/** A Moburst staff member's own API keys: make one, see them, revoke one. The route is staff only. */
export default function ApiKeys() {
  const { isMoburstStaff } = useAuth();
  const { data: keys = [], isLoading, isError, error, refetch } = usePersonalKeys(isMoburstStaff);
  const revoke = useRevokePersonalKey();
  const [creating, setCreating] = useState(false);
  const [toRevoke, setToRevoke] = useState<PersonalKey | null>(null);
  const [notRevoked, setNotRevoked] = useState<string | null>(null);
  const loaded = !isLoading && !isError;
  const active = keys.filter((k) => stateOf(k) === "active").length;

  const confirmRevoke = async (k: PersonalKey) => {
    setToRevoke(null);
    setNotRevoked(null);
    // Revoking twice answers the first revoke, so a send that failed on the server is safe to repeat.
    const { error: notDone } = await sendQuietly(
      () => revoke.mutateAsync(k.id).then(() => ({ error: null }), (e: unknown) => ({ error: e })),
      { again: (e) => invokeResendable(e, { idempotent: true }) },
    );
    if (notDone) {
      console.warn("[personal api key] not revoked yet", notDone);
      setNotRevoked(`${k.name} is not revoked yet.`);
      refetch();
    }
  };

  return (
    <AppLayout
      title="Your API keys"
      description="A key lets your own tools and scripts read Socialytics for you. Each key sees what you see here, is read only, and expires after 90 days."
      meta={loaded ? <span className="t-label">{active} of {ACTIVE_LIMIT} active</span> : undefined}
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          Create key
        </Button>
      }
    >
      <Card>
        <CardContent className="space-y-3">
          {notRevoked && <p role="status" className="t-secondary">{notRevoked}</p>}
          {isLoading ? (
            <Loading label="Loading your keys" />
          ) : isError ? (
            // Not the same as having no keys: it keeps loading and tries again on its own.
            <LoadRetry context="personal api keys" error={error} label="Loading your keys" onRetry={() => refetch()} />
          ) : keys.length === 0 ? (
            <EmptyState compact framed={false} icon={KeyRound} title="No keys yet" description="Create a key to read Socialytics from your own tools and scripts." />
          ) : (
            <ul className="space-y-2">
              {keys.map((k) => (
                <KeyRow key={k.id} k={k} onRevoke={setToRevoke} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
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
    </AppLayout>
  );
}
