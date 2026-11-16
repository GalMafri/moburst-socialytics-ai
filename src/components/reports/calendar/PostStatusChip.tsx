import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { statusLabel, type PostStatus } from "./postStatus";
import type { SendState } from "@/components/reports/SchedulePostModal";

const STATUS_CLASS: Record<PostStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  designed: "bg-secondary text-secondary-foreground",
  approved: "bg-accent text-accent-foreground",
  scheduled: "bg-primary text-primary-foreground",
};

interface Props {
  status: PostStatus;
  /**
   * If provided AND the user is not a client AND status is designed/approved,
   * the chip becomes a real clickable button to toggle the approved state.
   */
  onToggleApproved?: () => void;
  /** For a sent post: where its send stands (sendStateOf), so the chip says what the post's panel says. */
  sendState?: SendState;
}

export function PostStatusChip({ status, onToggleApproved, sendState }: Props) {
  const { isClient, isMoburstStaff } = useAuth();
  const clickable =
    !isClient &&
    (status === "designed" || status === "approved") &&
    !!onToggleApproved;

  const badgeContent = (
    <Badge
      className={`${STATUS_CLASS[status]} t-badge tracking-[-0.2px] py-1 px-2.5 rounded-full ${
        clickable ? "group-hover/chip:opacity-80 transition-opacity" : ""
      }`}
    >
      {statusLabel(status, !!isMoburstStaff, sendState)}
    </Badge>
  );

  if (!clickable) {
    return badgeContent;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleApproved?.();
      }}
      aria-label={
        status === "approved"
          ? "Unmark as approved"
          : "Mark as approved"
      }
      title={
        status === "approved"
          ? "Click to unmark as approved"
          : "Click to mark as approved"
      }
      className="group/chip pointer-events-auto inline-flex items-center rounded-full
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {badgeContent}
    </button>
  );
}
