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
   * the chip becomes clickable to toggle the approved state.
   */
  onToggleApproved?: () => void;
}

export function PostStatusChip({ status, onToggleApproved }: Props) {
  const { isClient } = useAuth();
  const clickable =
    !isClient &&
    (status === "designed" || status === "approved") &&
    onToggleApproved;
  return (
    <Badge
      className={`${STATUS_CLASS[status]} ${clickable ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={clickable ? onToggleApproved : undefined}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
