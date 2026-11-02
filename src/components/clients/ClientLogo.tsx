type ClientLogoClient = { name: string; logo_url?: string | null };

/**
 * A client's logo at a fixed height with its own width, so a wide wordmark
 * shows whole instead of being cropped to a square. Without a logo, the
 * client's initials stand in.
 */
export function ClientLogo({ client }: { client: ClientLogoClient }) {
  if (client.logo_url) {
    return <img src={client.logo_url} alt="" className="h-10 w-auto max-w-[8rem] shrink-0 rounded-[8px] object-contain" />;
  }
  return (
    <div className="h-10 w-10 shrink-0 rounded-[8px] bg-white/10 flex items-center justify-center t-badge text-white" aria-hidden="true">
      {client.name.slice(0, 2).toUpperCase()}
    </div>
  );
}
