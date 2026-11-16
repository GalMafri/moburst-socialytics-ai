import type { SendState } from "@/components/reports/SchedulePostModal";

/** "scheduled" is a post sent to Sprout, where it waits as a draft to be approved; nothing reads Sprout back, so no status says Published. */
export type PostStatus = "draft" | "designed" | "approved" | "scheduled";

/** The words a client reads: the scheduling tool's name is not for them. */
export const CLIENT_STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  designed: "Designed",
  approved: "Approved",
  scheduled: "Sent for scheduling",
};

/** The words staff read, built from the client's and read only where the viewer is staff. */
export const STATUS_LABEL: Record<PostStatus, string> = { ...CLIENT_STATUS_LABEL, scheduled: "Draft in Sprout" };

/**
 * Staff read where a sent post's send stands, in the words of the panel and the dialog (sendStateOf): being sent,
 * or never confirmed by Sprout. A client reads "Sent for scheduling" for every sent state.
 */
const STAFF_SEND_LABEL: Partial<Record<SendState, string>> = {
  being_sent: "Sending to Sprout",
  unconfirmed: "Not confirmed by Sprout",
};

export function statusLabel(status: PostStatus, isStaff: boolean, sendState?: SendState): string {
  if (isStaff && status === "scheduled" && sendState && STAFF_SEND_LABEL[sendState]) return STAFF_SEND_LABEL[sendState]!;
  return (isStaff ? STATUS_LABEL : CLIENT_STATUS_LABEL)[status];
}

/**
 * Resolve the current display status for a calendar post given the latest
 * iteration's data + any scheduled-post linkage.
 *
 * Priority order:
 *   scheduled > approved > designed > draft
 *
 * "Designed" requires BOTH that media exists AND at least one variant is
 * marked is_selected — generation without a favorite is not yet "designed".
 *
 * A Story never reaches "scheduled": Sprout cannot publish one, so it is
 * posted by hand (supabase/functions/_shared/design/story.ts).
 */
export function resolvePostStatus(args: {
  mediaUrls: string[];
  isSelectedAny: boolean;
  isApproved: boolean;
  hasScheduledPost: boolean;
  story?: boolean;
}): PostStatus {
  if (args.hasScheduledPost && !args.story) return "scheduled";
  if (args.isApproved) return "approved";
  if (args.mediaUrls.length > 0 && args.isSelectedAny) return "designed";
  return "draft";
}
