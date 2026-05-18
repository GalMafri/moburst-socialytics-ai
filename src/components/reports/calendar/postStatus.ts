import type { PostStatus } from "./PostStatusChip";

/**
 * Resolve the current display status for a calendar post given the latest
 * iteration's data + any scheduled-post linkage.
 *
 * Priority order:
 *   scheduled > approved > designed > draft
 *
 * "Designed" requires BOTH that media exists AND at least one variant is
 * marked is_selected — generation without a favorite is not yet "designed".
 */
export function resolvePostStatus(args: {
  mediaUrls: string[];
  isSelectedAny: boolean;
  isApproved: boolean;
  hasScheduledPost: boolean;
}): PostStatus {
  if (args.hasScheduledPost) return "scheduled";
  if (args.isApproved) return "approved";
  if (args.mediaUrls.length > 0 && args.isSelectedAny) return "designed";
  return "draft";
}
