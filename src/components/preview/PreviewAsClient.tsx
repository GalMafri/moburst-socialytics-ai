import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LoadRetry } from "@/components/ui/load-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveClients } from "@/lib/activeClients";
import { useIdentitySwitch } from "@/hooks/useRolePreview";
import { notStartedSentence, ROLE_PREVIEW_KEY, startRolePreview, stopRolePreview, type RolePreview } from "@/lib/rolePreview";

/**
 * "Preview as a client", in the signed-in person's own block of the sidebar.
 * Staff only: the sidebar renders it for Moburst staff, and the function
 * refuses anyone else whatever the page shows. A staff member chooses one
 * active client and from Start on uses Socialytics as a client user of that
 * client, until they choose Exit preview on the band at the top of the page.
 */
export function PreviewAsClient() {
  const [open, setOpen] = useState(false);
  /** A start is on its way: the dialog stays as it is until the answer. */
  const [starting, setStarting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!starting) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title="Preview as a client"
          className="w-full justify-start group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Eye aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">Preview as a client</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* The choice reads the clients only once the dialog is open, and starts empty each time. */}
        <ClientChoice starting={starting} onStarting={setStarting} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ClientChoice({ starting, onStarting, onClose }: { starting: boolean; onStarting: (starting: boolean) => void; onClose: () => void }) {
  const [clientId, setClientId] = useState("");
  /** Why the preview has not started, as a sentence; null before a try. */
  const [notStarted, setNotStarted] = useState<string | null>(null);
  /** A preview of another client that is already open for this person; the chosen one has not started. */
  const [openElsewhere, setOpenElsewhere] = useState<RolePreview | null>(null);
  // The same list every client picker reads: the active clients this person can see.
  const clients = useActiveClients<{ id: string; name: string }>("id, name");
  const switchIdentity = useIdentitySwitch();
  const queryClient = useQueryClient();
  const chosen = clients.data?.find((c) => c.id === clientId);

  const start = async () => {
    if (!clientId) return;
    onStarting(true);
    setNotStarted(null);
    setOpenElsewhere(null);
    const result = await startRolePreview(clientId).catch((err) => {
      console.warn("[client preview] not started", err);
      return { preview: null, code: null };
    });
    onStarting(false);
    if (!result.preview) {
      setNotStarted(notStartedSentence(result.code));
      // Ask again what is true: an answer can be lost after the preview began.
      void queryClient.invalidateQueries({ queryKey: ROLE_PREVIEW_KEY });
      return;
    }
    // QA 22 Nov 2026: an open preview counts as started only when it is of the
    // client chosen here. One of another client (another tab, an Exit that
    // never reached the server) used to switch the tab into that client with
    // no word; the dialog now says which preview is open and lets the person
    // go to it or end it and start this one.
    if (result.preview.client_id !== clientId) {
      setOpenElsewhere(result.preview);
      return;
    }
    onClose();
    await switchIdentity({ preview: result.preview, ended: false });
  };

  const goToOpen = async () => {
    if (!openElsewhere) return;
    onClose();
    await switchIdentity({ preview: openElsewhere, ended: false });
  };

  const endOpenAndStart = async () => {
    onStarting(true);
    const { ok } = await stopRolePreview();
    onStarting(false);
    if (!ok) {
      setNotStarted(notStartedSentence(null));
      return;
    }
    await start();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Preview as a client</DialogTitle>
        <DialogDescription>
          {chosen
            ? `You will see Socialytics exactly as a user of ${chosen.name} sees it, until you choose Exit preview.`
            : "Choose a client to see Socialytics exactly as a user of that client sees it."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="preview-client">Client</Label>
        {clients.isError ? (
          <LoadRetry context="clients for the client preview" error={clients.error} label="Loading the clients" onRetry={() => clients.refetch()} />
        ) : (
          <Select value={clientId} onValueChange={(id) => { setClientId(id); setNotStarted(null); setOpenElsewhere(null); }} disabled={starting || clients.isLoading}>
            <SelectTrigger id="preview-client">
              <SelectValue placeholder={clients.isLoading ? "Loading the clients" : "Choose a client"} />
            </SelectTrigger>
            <SelectContent>
              {(clients.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {notStarted && <p className="t-label" role="status">{notStarted}</p>}
      {openElsewhere && !notStarted && (
        <div className="space-y-2" role="status">
          <p className="t-label">
            A preview of {openElsewhere.client_name} is already open, so the preview of {chosen?.name ?? "this client"} has not started.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void goToOpen()} disabled={starting}>Go to the {openElsewhere.client_name} preview</Button>
            <Button size="sm" variant="outline" onClick={() => void endOpenAndStart()} disabled={starting}>End it and preview {chosen?.name ?? "this client"}</Button>
          </div>
        </div>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onClose} disabled={starting}>Cancel</Button>
        <Button onClick={start} disabled={!clientId || starting}>
          {starting && <Loader2 className="animate-spin" aria-hidden="true" />}
          Start
        </Button>
      </DialogFooter>
    </>
  );
}
