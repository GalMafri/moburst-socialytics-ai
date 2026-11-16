import type { DesignRequest } from "@/lib/designRequests";
import { platformName } from "@/lib/display";

/** A short name for a post in progress cards: its platform and the start of its copy. */
export function postLabel(r: Pick<DesignRequest, "platform" | "post_copy">): string {
  const words = r.post_copy.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  const platform = platformName(r.platform) || "Post";
  return `${platform} · ${words}${r.post_copy.trim().split(/\s+/).length > 8 ? "…" : ""}`;
}
