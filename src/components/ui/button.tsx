import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-[14px] font-bold tracking-[-0.5px] leading-[17px] transition-all duration-200 ease-out press-effect cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#b9e045] text-black hover:bg-[#c5e85c] shadow-[0px_10px_15px_0px_#3a441d]",
        destructive: "bg-[rgba(239,68,68,0.2)] text-red-400 hover:bg-[rgba(239,68,68,0.3)]",
        outline: "border border-[rgba(255,255,255,0.1)] bg-[rgba(21,23,28,0.2)] text-white hover:bg-[rgba(255,255,255,0.06)] font-medium",
        secondary: "bg-[rgba(255,255,255,0.06)] text-[#9ca3af] hover:bg-[rgba(255,255,255,0.10)] hover:text-white font-medium",
        ghost: "hover:bg-[rgba(255,255,255,0.06)] hover:text-white text-[#9ca3af] font-medium",
        link: "text-[#b9e045] underline-offset-4 hover:underline font-medium",
      },
      size: {
        default: "h-[40px] px-[20px]",
        sm: "h-[36px] px-[12px]",
        lg: "h-[44px] px-[32px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
