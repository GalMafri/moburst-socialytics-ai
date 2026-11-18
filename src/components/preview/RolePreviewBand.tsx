import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useIdentitySwitch, useRolePreview } from "@/hooks/useRolePreview";
import { NO_PREVIEW, stopRolePreview } from "@/lib/rolePreview";

/**
 * The band across the top of every page while a staff member is using
 * Socialytics as a client (Preview as a client, 18 Nov 2026). It says whose
 * view this is, that what they do here is done for real (a client user can
 * request designs and edit their posts, and so can the person previewing as
 * one), and holds the one way out. Everything under it is exactly what a
 * client user of that client sees.
 *
 * It shows only for a person with an open preview of their own. A real
 * client has none and a staff member not in a preview has none, so neither
 * ever sees it.
 */
export function RolePreviewBand() {
  const { data } = useRolePreview();
  const switchIdentity = useIdentitySwitch();
  const [busy, setBusy] = useState(false);
  /** Exit was chosen and the person is still in the preview. */
  const [stillIn, setStillIn] = useState(false);

  const preview = data?.preview;
  if (!preview) return null;

  const exit = async () => {
    setBusy(true);
    setStillIn(false);
    const { ok } = await stopRolePreview().catch((err) => {
      console.warn("[client preview] not left yet", err);
      return { ok: false };
    });
    try {
      if (ok) await switchIdentity(NO_PREVIEW);
      else setStillIn(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Client preview"
      className="relative z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[rgba(185,224,69,0.35)] bg-[rgba(185,224,69,0.12)] px-page py-2"
    >
      <p className="t-label !text-white flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0 text-[#b9e045]" aria-hidden="true" />
        <span>You are previewing Socialytics as a client user of {preview.client_name}. Anything you change or request here is real.</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {stillIn && <span className="t-label" role="status">You are still in the preview. To leave it, choose Exit preview again.</span>}
        <Button size="sm" variant="outline" onClick={exit} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          Exit preview
        </Button>
      </div>
    </div>
  );
}

/**
 * Keeps a tab on the right side of a preview that changed somewhere else.
 * Mounted once. A preview can start or end without this tab doing it:
 * another tab, 8 hours passing, or a new sign-in. When the last check and
 * the role this tab holds disagree, the tab changes sides the same way
 * Start and Exit do.
 *
 * A tab that has shown a preview remembers it. When a later check finds no
 * preview at all (Exit was chosen in another tab, so there is no open row
 * and nothing says "ended"), that memory is what tells this tab it is still
 * on the client side of a preview that is over.
 */
export function RolePreviewSync() {
  const { data } = useRolePreview();
  const { userRole } = useAuth();
  const switchIdentity = useIdentitySwitch();
  const handled = useRef<string | null>(null);
  const sawPreview = useRef(false);
  const previewId = data?.preview?.id ?? null;
  const ended = !!data?.ended;

  useEffect(() => {
    if (!data || !userRole) return;
    if (previewId !== null) sawPreview.current = true;
    const asClient = userRole === "client";
    const over = previewId === null && (ended || sawPreview.current);
    // In a preview with a staff screen, or out of one with the preview's client screen.
    const behind = (previewId !== null && !asClient) || (over && asClient);
    if (previewId === null && !asClient) sawPreview.current = false;
    const key = `${previewId}:${over}:${userRole}`;
    if (!behind || handled.current === key) return;
    handled.current = key;
    if (previewId === null) sawPreview.current = false;
    void switchIdentity({ preview: data.preview, ended: false }).catch((err) => console.warn("[client preview] this tab is not updated yet", err));
  }, [data, previewId, ended, userRole, switchIdentity]);

  return null;
}
