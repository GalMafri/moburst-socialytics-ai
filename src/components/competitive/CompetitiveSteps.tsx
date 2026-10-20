/**
 * The four steps of competitive analysis, in order, on every screen that is
 * part of them.
 *
 * People arrived on the review page, the run page and the setup dialog with no
 * idea which of them came first or what was already done. Each step says what
 * its own state is and links to where it happens, so the flow is readable
 * without pressing anything.
 */

import { Link } from "react-router-dom";
import { Check, Circle, Dot } from "lucide-react";
import type { FlowState } from "@/lib/competitiveFlow";
import { cn } from "@/lib/utils";

export type CompetitiveStep = FlowState & {
  title: string;
  /** Where this step is done; omitted for the step you are already on. */
  href?: string;
  linkLabel?: string;
};

export function CompetitiveSteps({ steps, current }: { steps: CompetitiveStep[]; current: number }) {
  return (
    <ol className="grid gap-inner sm:grid-cols-2 xl:grid-cols-4" aria-label="Competitive analysis steps">
      {steps.map((step, i) => {
        const state = step.ready ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={step.title}
            aria-current={i === current ? "step" : undefined}
            className={cn("glass-inner p-inner flex flex-col gap-1", i === current && "is-selected")}
          >
            <p className="t-subhead flex items-center gap-1.5">
              {state === "done" ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : state === "current" ? <Dot className="h-3.5 w-3.5 text-[#b9e045]" aria-hidden /> : <Circle className="h-3 w-3 text-[#b1b7c1]" aria-hidden />}
              Step {i + 1} · {step.title}
            </p>
            {step.headline && <p className="t-body">{step.headline}</p>}
            {step.detail && <p className="t-secondary">{step.detail}</p>}
            {step.href && (
              <Link to={step.href} className="t-label !text-[#b9e045] hover:underline underline-offset-2 mt-auto pt-1 w-fit">
                {step.linkLabel || "Open"}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
