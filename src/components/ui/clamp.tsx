// Long AI prose, shown a few lines at a time. Reports carry paragraphs that
// run to 800 characters; readers get the first lines and choose to expand.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function Clamp({ text, lines = 3, className = "" }: { text: string; lines?: 2 | 3 | 4; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 110;
  const clampClass = lines === 2 ? "line-clamp-2" : lines === 4 ? "line-clamp-4" : "line-clamp-3";
  return (
    <div className={className}>
      <p className={open || !long ? "" : clampClass}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.05)] px-3 py-1 t-label text-white hover:bg-[rgba(255,255,255,0.10)]">
          {open ? "Show less" : "Show more"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
