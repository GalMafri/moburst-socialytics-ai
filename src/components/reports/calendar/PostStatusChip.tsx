import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

export type PostStatus = "draft" | "designed" | "approved" | "scheduled" | "published";

const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  designed: "Designed",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

const STATUS_CLASS: Record<PostStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  designed: "bg-secondary text-secondary-foreground",
  approved: "bg-accent text-accent-foreground",
  scheduled: "bg-primary text-primary-foreground",
  published: "bg-success text-success-foreground",
};

interface Props {
  status: PostStatus;
  /**
   * If provided AND the user is not a client AND status is designed/approved,
   * the chip becomes a real clickable button to toggle the approved state.
   */
  onToggleApproved?: () => void;
}

export function PostStatusChip({ status, onToggleApproved }: Props) {
  const { isClient } = useAuth();
  const clickable =
    !isClient &&
    (status === "designed" || status === "approved") &&
    !!onToggleApproved;

  const badgeContent = (
    <Badge
      className={`${STATUS_CLASS[status]} text-sm py-1 px-2.5 ${
        clickable ? "group-hover/chip:opacity-80 transition-opacity" : ""
      }`}
    >
      {STATUS_LABEL[status]}
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
      className="group/chip inline-flex items-center rounded-full
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {badgeContent}
    </button>
  );
}
