/**
 * Editing one section of a client's strategy (spec: docs/superpowers/specs/
 * 2026-11-03-strategy-v2-design.md, section 1, "Editing"). A card shows a
 * person's version wherever one exists, with an "Edited by" chip; its pencil
 * opens a sheet with the card's fields. A save goes through
 * strategy_section_save with the fields and the same version as plain lines,
 * the one section save the connector uses too (strategy_section_save_as),
 * and is sent again quietly when it does not get through. A version saved
 * from the connector is plain text: the card shows it with a "From the
 * connector" chip. Handing a section back returns it to the written version,
 * and so does a save that holds the written version as it is. A person's goals and
 * platform cards keep only what they typed: the numbers, dates and worked
 * posts shown come from the latest write (strategyView's shownValue, the same
 * reader the deck and the planner use). A line with only half filled in is not
 * saved: Save waits and the empty half is marked and explained. Goals a person
 * wrote that match none of the latest goals are listed in the sheet and kept
 * until they are removed there. Nothing here
 * reports a failure: a save that does not get through keeps the form open and
 * says it is not saved yet.
 */

import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { editedChip, shownValue, type StrategyEdit } from "@/lib/strategyView";
import { choicesFor, fieldsOf, formIssue, fromForm, kindOf, savedAsWritten, toForm, type Form, type Pair } from "@/lib/strategyForms";
import { latestCompetitorSet, selectedCompetitors } from "../../../supabase/functions/_shared/strategy/competitorSet";
import { orphanGoalItems, sectionLines } from "../../../supabase/functions/_shared/strategy/sections";

export type { StrategyEdit };
export { editedChip };

/** One section's place in the strategy: what a card needs to show and save it. */
export interface SectionProps {
  clientId: string;
  sectionKey: string;
  /** The product's version: fields (v2) or text (2 Nov). */
  product: unknown;
  edit?: StrategyEdit;
  /** Competitors and platforms the page knows beyond the client's own competitor set, offered in the sheet's pickers. */
  competitorNames?: string[];
  platformNames?: string[];
  onSaved: () => unknown;
}

/** The client's competitors, as the strategy writer reads them: the newest competitor set's selected companies. Read when a positioning sheet opens; none when it cannot be read (the sheet still offers the competitors the positioning names). The rule for which set is the writer's, in competitorSet.ts. */
function useCompetitorSet(clientId: string, wanted: boolean): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void (async () => {
      try {
        const { data: set, error } = await latestCompetitorSet(supabase, clientId);
        if (error) throw error;
        if (!set) return;
        const { data, error: namesError } = await selectedCompetitors(supabase, set.id, "name");
        if (namesError) throw namesError;
        if (live) setNames(((data ?? []) as Array<{ name: string | null }>).map((c) => String(c.name ?? "").trim()).filter(Boolean));
      } catch (err) { console.warn("[strategy] the competitor set could not be read", err); }
    })();
    return () => { live = false; };
  }, [clientId, wanted]);
  return names;
}

/** Editing one section: what is shown, the sheet's form, the save. */
export function useSectionEdit({ clientId, sectionKey, product, edit, competitorNames, platformNames, onSaved }: SectionProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  // What the last save answered (the saved row, or null when handed back),
  // shown until the page's own read of people's versions catches up.
  const [saved, setSaved] = useState<{ edit: StrategyEdit | null } | null>(null);
  useEffect(() => setSaved(null), [edit?.text, edit?.edited_at]);
  const current = saved ? saved.edit ?? undefined : edit;
  // A person's typed words over the latest write's numbers, dates and worked posts.
  const shown = shownValue(product, current);
  // Goals a person wrote that match none of the latest write's goals: shown in the sheet and kept in what is saved until the person removes them.
  const orphans = useMemo(() => (sectionKey === "goals" && current ? orphanGoalItems(product, current.value) : []), [sectionKey, product, current]);
  const [earlier, setEarlier] = useState<Array<Record<string, unknown>>>([]);
  const earlierGoals = earlier.map((g) => ({ title: String(g.title ?? "").trim(), why: String(g.why ?? "").trim() }));
  const competitorSet = useCompetitorSet(clientId, open && kindOf(sectionKey) === "positioning");
  // The form starts from the version shown when it has fields, else from the product's fields.
  const base = shown && typeof shown === "object" ? shown : product;
  // A strategy written on 2 Nov has text, not fields: its sheet edits the text.
  const textMode = typeof base === "string" || base === null || base === undefined;
  const fields = textMode ? [{ name: "text", label: "Text", kind: "lines" as const }] : fieldsOf(sectionKey, base, choicesFor(product, shown, [...(competitorNames ?? []), ...competitorSet], platformNames));

  // The sheet cannot be saved while a line has only one half; the empty half is marked required.
  const issue = textMode ? null : formIssue(sectionKey, form);

  const send = async (text: string, value: Record<string, unknown> | null) => {
    setSaving(true);
    setNotSaved(false);
    const { data, error } = await sendQuietly(
      () => supabase.rpc("strategy_section_save", { p_client: clientId, p_key: sectionKey, p_text: text, p_value: value as never }),
      { again: writeResendable },
    );
    setSaving(false);
    if (error) {
      console.warn("[strategy] not saved yet", sectionKey, error);
      setNotSaved(true);
      return;
    }
    setSaved({ edit: (data as unknown as StrategyEdit | null) ?? null });
    setOpen(false);
    void onSaved();
  };

  return {
    current, shown, fields, form, open, saving, notSaved, issue, base, earlierGoals,
    /** Goals and platform cards show current numbers and dates over the person's words. */
    keepsFigures: kindOf(sectionKey) === "goals" || kindOf(sectionKey) === "platform",
    /** A version that is only text (a 2 Nov edit, or one saved from Claude), shown in the sheet beside the fields that replace it. */
    earlierText: !textMode && typeof current?.text === "string" && !(current?.value && typeof current.value === "object") ? current.text : null,
    earlierFromClaude: current?.source === "claude",
    setField: (name: string, v: string | Pair[]) => { setForm((f) => ({ ...f, [name]: v })); },
    /** Takes an earlier goal out of what the next save keeps. */
    removeEarlier: (i: number) => setEarlier((list) => list.filter((_, at) => at !== i)),
    start: () => { setEarlier(orphans); setForm(textMode ? { text: typeof shown === "string" ? shown : "" } : toForm(sectionKey, base)); setNotSaved(false); setOpen(true); },
    cancel: () => { setNotSaved(false); setOpen(false); },
    save: () => {
      if (textMode) return send(String(form.text ?? "").trim(), null);
      if (issue) return;
      // The saved text holds only the words typed; numbers and dates are read from the latest write when shown.
      const value = fromForm(sectionKey, form, base, earlier);
      // A save of the written version as it is (no earlier goals kept) hands the card back: no person's version is made.
      if (savedAsWritten(sectionKey, value, product)) return send("", null);
      // The text is the goals as shown; the earlier goals stay in the value only.
      return send(sectionLines(sectionKey, fromForm(sectionKey, form, base)), value);
    },
    handBack: () => send("", null),
  };
}

export type SectionEditor = ReturnType<typeof useSectionEdit>;

/** The pencil on a card. Never printed. */
export function EditButton({ e, label }: { e: SectionEditor; label: string }) {
  if (!e.fields.length) return null;
  return (
    <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={e.start} aria-label={`Edit ${label}`} data-print="hide">
      <Pencil className="h-4 w-4" aria-hidden />
    </Button>
  );
}

/** "Edited by Neria, 4 Nov", on a card a person changed. */
export function EditedChip({ e }: { e: SectionEditor }) {
  if (!e.current) return null;
  return <span className="t-label rounded-full px-2.5 py-0.5 bg-[rgba(255,255,255,0.06)] whitespace-nowrap" data-print="hide">{editedChip(e.current)}</span>;
}
