// Client setup, Brief tab, "Claude project" (two-way sync with Claude,
// docs/superpowers/specs/2026-11-03-claude-sync-design.md): the instruction
// for this client's Claude project and the one-time prompt that sends the
// project's knowledge to Socialytics, with the client's name and id filled
// in, each with a Copy button. Pasting the instruction into the project is
// the one step left to the team: Claude has no way for Socialytics to write
// a project. Staff only. A copy that the browser does not allow selects the
// text instead, so it can be copied by hand.

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { knowledgePrompt, projectInstruction } from "@/lib/claudeProject";

function CopyText({ id, label, hint, text }: { id: string; label: string; hint: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Select it, so a person can copy it themselves.
      const range = document.createRange();
      if (box.current) {
        range.selectNodeContents(box.current);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p id={`${id}-label`} className="t-body font-medium">{label}</p>
          <p className="t-label">{hint}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()} aria-label={`Copy the ${label.toLowerCase()}`}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre id={id} ref={box} tabIndex={0} aria-labelledby={`${id}-label`} className="glass-inner p-inner t-body whitespace-pre-wrap break-words font-sans max-h-72 overflow-auto">{text}</pre>
    </div>
  );
}

export function ClaudeProject({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { isMoburstStaff } = useAuth();
  if (!isMoburstStaff || !clientId) return null;
  const client = { id: clientId, name: clientName.trim() || "this client" };
  return (
    <Section
      layout="split"
      eyebrow="Claude"
      title="Claude project"
      description={`With these in ${client.name}'s Claude project, Claude reads this client's notes, strategy and calendar from Socialytics and saves notes, approved copy, strategy edits and finished decks back here.`}
    >
      <CopyText id="claude-project-instruction" label="Project instruction" hint="Paste into the project's instructions in Claude." text={projectInstruction(client)} />
      <CopyText id="claude-knowledge-prompt" label="Send this project's knowledge" hint="Send once in a chat in the project. Sending it again adds nothing already saved." text={knowledgePrompt(client)} />
    </Section>
  );
}
