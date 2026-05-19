import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A Card that's keyboard-accessible: focus ring, Enter/Space activation,
 * hover state. Replaces the `<div className="cursor-pointer" onClick>`
 * antipattern across the app.
 *
 * Use this for entire-card click targets (list rows, dashboard tiles).
 * For cards with their own buttons inside, prefer keeping the card as
 * `<a>` and let the inner buttons stopPropagation.
 */
interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  onClick: () => void;
  /** Accessible label describing what activating the card will do. */
  ariaLabel: string;
  /** Optional disabled state. */
  disabled?: boolean;
  /** Pass through Card-styling className. */
  className?: string;
  children: React.ReactNode;
}

export function ClickableCard({
  onClick,
  ariaLabel,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "cursor-pointer transition-colors hover:border-primary/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled && "opacity-60 cursor-not-allowed pointer-events-none",
        className,
      )}
      {...rest}
    >
      {children}
    </Card>
  );
}
