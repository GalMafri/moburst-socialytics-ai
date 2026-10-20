import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("glass text-card-foreground animate-slide-up", className)} {...props} />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-card", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("t-h3", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("t-secondary", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

// Under a CardHeader the content continues the header's padding; as the first
// thing in a card it takes the full card padding on its own, so a card without
// a header no longer needs a pt-5 written at every call site.
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-card pt-0 first:pt-card", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-card pt-0 first:pt-card", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

/**
 * The one card heading: an optional icon, the title and a line of context,
 * with the card's own actions beside them. Use it for a card that has a body
 * (a list, a table, a form) under the heading, so the actions sit over what
 * they act on. A card that would be only a heading and buttons is a
 * `Section layout="split"` or belongs in the page header's actions instead.
 */
function CardHeading({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <CardHeader className={cn("flex-row flex-wrap items-start justify-between gap-x-6 gap-y-3 space-y-0", className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <CardTitle className="flex items-center gap-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </CardHeader>
  );
}

export { Card, CardHeader, CardHeading, CardFooter, CardTitle, CardDescription, CardContent };
