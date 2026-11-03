/**
 * One section of a client's content strategy, as people read and edit it
 * (spec: docs/superpowers/specs/2026-11-02-content-strategy-tab-design.md,
 * "Editing, and how edits survive"). The page shows a person's version
 * wherever one exists, and says who wrote it and that it is kept when the
 * strategy is rewritten; otherwise the product's version and what it was
 * written from. Edit swaps the text for a box with Save and Cancel; a save
 * goes through strategy_section_save and is sent again quietly when it does
 * not get through. Saving empty text, or "Use the product's version", hands
 * the section back. Nothing here reports a failure: a save that does not get
 * through keeps the text in the box and says it is not saved yet.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Pencil, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/ui/section";
import { Prose } from "@/components/ui/prose";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/display";
import { sendQuietly, writeResendable } from "@/lib/quietSend";

/** A person's version of a section (content_strategy_edits). */
export interface StrategyEdit {
  section_key: string;
  text: string;
  editor_name: string;
  edited_at: string;
  /** claude when the person saved it from Claude. */
  source?: string | null;
}

/** When the product's version was written, and from what. */
export interface Written {
  at: string;
  sources: string[];
}

/** One section's place in the strategy: what each editor needs to show and save it. */
export interface SectionProps {
  clientId: string;
  sectionKey: string;
  /** The product's version. */
  product: string;
  edit?: StrategyEdit;
  written: Written;
  onSaved: () => unknown;
}

const SOURCE_WORDS: Record<string, string> = {
  brief: "the brief",
  strategy_doc: "the strategy document",
  website: "the website",
  brand_book: "the brand book",
  competitors: "the tracked competitors",
  posts: "90 days of posts",
};

/** "the brief, the website and 90 days of posts". */
export function writtenFrom(sources: string[]): string {
  const words = sources.map((s) => SOURCE_WORDS[s]).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Where the text on screen came from, in one line. */
export function originLine(edit: StrategyEdit | undefined, written: Written): string {
  if (edit) {
    const first = String(edit.editor_name ?? "").trim().split(/\s+/)[0] || "your team";
    const by = edit.source === "claude" ? `From Claude, by ${first}` : `Edited by ${first}`;
    return `${by} on ${formatDate(edit.edited_at, { year: false })}. Kept when the strategy is rewritten.`;
  }
  const from = writtenFrom(written.sources);
  return `Written on ${formatDate(written.at, { year: false })}${from ? ` from ${from}` : ""}.`;
}

/** Editing one section: the text shown, the box, and the save. */
export function useSectionEdit({ clientId, sectionKey, product, edit, onSaved }: SectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  // What the last save answered (the saved row, or null when handed back),
  // shown until the page's own read of people's versions catches up.
  const [saved, setSaved] = useState<{ edit: StrategyEdit | null } | null>(null);
  useEffect(() => setSaved(null), [edit?.text, edit?.edited_at]);
  const current = saved ? saved.edit ?? undefined : edit;
  const shown = current?.text ?? product;

  const send = async (text: string) => {
    setSaving(true);
    setNotSaved(false);
    const { data, error } = await sendQuietly(
      () => supabase.rpc("strategy_section_save", { p_client: clientId, p_key: sectionKey, p_text: text }),
      { again: writeResendable },
    );
    setSaving(false);
    if (error) {
      console.warn("[strategy] not saved yet", sectionKey, error);
      setNotSaved(true);
      return;
    }
    setSaved({ edit: (data as unknown as StrategyEdit | null) ?? null });
    setEditing(false);
    void onSaved();
  };

  return {
    current, shown, editing, draft, saving, notSaved, setDraft,
    start: () => { setDraft(shown); setNotSaved(false); setEditing(true); },
    cancel: () => { setNotSaved(false); setEditing(false); },
    save: () => send(draft.trim()),
    handBack: () => send(""),
  };
}

type Editor = ReturnType<typeof useSectionEdit>;

/** Edit, or Save and Cancel while editing, and "Use the product's version" over a person's version. */
function EditActions({ e, label, edited }: { e: Editor; label: string; edited: boolean }) {
  if (e.editing) {
    return (
      <>
        <Button size="sm" onClick={() => void e.save()} disabled={e.saving}>
          {e.saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={e.cancel} disabled={e.saving}>Cancel</Button>
      </>
    );
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={e.start} aria-label={`Edit ${label}`}>
        <Pencil /> Edit
      </Button>
      {edited && (
        <Button size="sm" variant="ghost" onClick={() => void e.handBack()} disabled={e.saving}>
          {e.saving && <Loader2 className="animate-spin" />}
          Use the product's version
        </Button>
      )}
    </>
  );
}

/** The text, or the box while editing. */
function EditableText({ e, label, testId, render }: { e: Editor; label: string; testId: string; render?: (text: string) => ReactNode }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      {e.editing ? (
        <Textarea aria-label={label} value={e.draft} onChange={(ev) => e.setDraft(ev.target.value)} rows={10} className="t-body" />
      ) : (
        render ? render(e.shown) : <Prose text={e.shown} cards={false} />
      )}
      {e.notSaved && <p role="status" className="t-label">Your changes are kept here and are not saved yet.</p>}
    </div>
  );
}

/** A section with its title, origin and Edit on the left and its text on the right. */
export function StrategySection({ id, title, children, ...props }: SectionProps & { id: string; title: string; children?: ReactNode }) {
  const e = useSectionEdit(props);
  return (
    <Section
      layout="split"
      id={id}
      title={title}
      meta={<p>{originLine(e.current, props.written)}</p>}
      action={<EditActions e={e} label={title} edited={!!e.current} />}
    >
      {children}
      <EditableText e={e} label={title} testId={`${id}-text`} />
    </Section>
  );
}

/** A card in a section's grid (a pillar, a platform, the not now list), with its own Edit. */
export function StrategyCard({ title, label, facts, render, ...props }: SectionProps & {
  title: ReactNode;
  /** The card's name in words, for the Edit button and the box. */
  label: string;
  /** Lines of numbers code worked out, under the title. */
  facts?: ReactNode;
  render?: (text: string) => ReactNode;
}) {
  const e = useSectionEdit(props);
  return (
    <article className="glass-inner p-inner space-y-3 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 space-y-1.5">
          <h3 className="t-h4 flex flex-wrap items-center gap-2">{title}</h3>
          {facts}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditActions e={e} label={label} edited={!!e.current} />
        </div>
      </div>
      <p className="t-label">{originLine(e.current, props.written)}</p>
      <EditableText e={e} label={label} testId={`strategy-card-${props.sectionKey}`} render={render} />
    </article>
  );
}
