import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type LogoSurface = { logo_path?: string | null; background?: string | null };
type ClientLogoClient = {
  name: string;
  logo_url?: string | null;
  /** The client's design settings, embedded by the clients query: the stored logo copy and the surface the designs put it on. */
  design_brand_settings?: LogoSurface | LogoSurface[] | null;
};

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function surfaceOf(client: ClientLogoClient): { src: string | null; background: string | null } {
  const raw = client.design_brand_settings;
  const settings = (Array.isArray(raw) ? raw[0] : raw) ?? null;
  let stored: string | null = null;
  if (settings?.logo_path) {
    try {
      stored = supabase.storage.from("generated-media").getPublicUrl(settings.logo_path).data.publicUrl || null;
    } catch {
      stored = null;
    }
  }
  const background = settings?.background && COLOR.test(settings.background.trim()) ? settings.background.trim() : null;
  return { src: stored || client.logo_url || null, background };
}

/**
 * The one place a client's logo is drawn: a fixed height with its own width, so
 * a wide wordmark shows whole instead of being cropped to a square. A client
 * that has chosen a surface for its logo (the design settings' background) gets
 * the logo on that surface, so a dark logo is never lost on a dark card. Without
 * a logo, the client's initials stand in.
 */
export function ClientLogo({ client, size = "default", className }: { client: ClientLogoClient; size?: "default" | "compact"; className?: string }) {
  const { src, background } = surfaceOf(client);
  const height = size === "compact" ? "h-8" : "h-10";
  if (src && background) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center max-w-[8rem] rounded-[8px] p-1", height, className)} style={{ backgroundColor: background }}>
        <img src={src} alt="" className="h-full w-auto max-w-full object-contain" />
      </span>
    );
  }
  if (src) {
    return <img src={src} alt="" className={cn(height, "w-auto max-w-[8rem] shrink-0 rounded-[8px] object-contain", className)} />;
  }
  return (
    <div className={cn(height, size === "compact" ? "w-8" : "w-10", "shrink-0 rounded-[8px] bg-white/10 flex items-center justify-center t-badge text-white", className)} aria-hidden="true">
      {client.name.slice(0, 2).toUpperCase()}
    </div>
  );
}
