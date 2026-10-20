import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind.config.ts adds the layout spacing keys page / section / card /
// inner. tailwind-merge only knows Tailwind's own scale, so without this it
// kept both "p-card" and a caller's "p-4" and left the winner to stylesheet
// order.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["page", "section", "card", "inner"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
