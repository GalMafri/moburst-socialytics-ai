// The one state line for a press that did not get an answer (rule 7: nothing
// fails visibly). The press was already sent again quietly (src/lib/quietSend.ts);
// when the last try still gets no answer, the control says what is true now,
// that the thing is not done yet, and keeps its normal button so the person
// can press it again. It never carries an error, an id or a reason.

import { useCallback, useState, type ReactNode } from "react";

/** What a control says when its press got no answer. Each says only what is not done yet. */
export const NOT_YET = {
  start: "Not started yet.",
  use: "Not in use yet.",
  feedback: "Not saved yet.",
  delete: "Not deleted yet.",
  stop: "Not stopped yet.",
  remove: "Not removed yet.",
  sent: "Not sent yet.",
} as const;

/** The state line itself: a polite status next to the control. */
export function NotYet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p role="status" className={`t-secondary ${className}`.trim()}>{children}</p>;
}

/**
 * A control's state line: `say` it when a press got no answer, `clear` it when
 * the next press starts or one gets through. `line` is null when there is
 * nothing to say.
 */
export function useNotYet() {
  const [line, setLine] = useState<string | null>(null);
  const say = useCallback((text: string) => setLine(text), []);
  const clear = useCallback(() => setLine(null), []);
  return { line, say, clear };
}
