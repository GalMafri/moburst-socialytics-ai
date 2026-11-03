/**
 * Editing one section of a client's strategy (spec: docs/superpowers/specs/
 * 2026-11-03-strategy-v2-design.md, section 1, "Editing"). A card shows a
 * person's version wherever one exists, with an "Edited by" chip; its pencil
 * opens a sheet with the card's fields. A save goes through
 * strategy_section_save with the fields and the same version as plain lines,
 * and is sent again quietly when it does not get through. "Use the product's
 * version" hands the section back. Nothing here reports a failure: a save that
 * does not get through keeps the form open and says it is not saved yet.
 */

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { editedChip, shownValue, type StrategyEdit } from "@/lib/strategyView";
import { fieldsOf, fromForm, toForm, type Form } from "@/lib/strategyForms";
import { sectionLines } from "../../../supabase/functions/_shared/strategy/sections";

export type { StrategyEdit };

/** One section's place in the strategy: what a card needs to show and save it. */
export interface SectionProps {
  clientId: string;
  sectionKey: string;
  /** The product's version: fields (v2) or text (2 Nov). */
  product: unknown;
  edit?: StrategyEdit;
  onSaved: () => unknown;
}

/** Editing one section: what is shown, the sheet's form, the save. */
export function useSectionEdit({ clientId, sectionKey, product, edit, onSaved }: SectionProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  // What the last save answered (the saved row, or null when handed back),
  // shown until the page's own read of people's versions catches up.
  const [saved, setSaved] = useState<{ edit: StrategyEdit | null } | null>(null);
  useEffect(() => setSaved(null), [edit?.text, edit?.edited_at]);
  const current = saved ? saved.edit ?? undefined : edit;
  const shown = shownValue(product, current);
  // The form starts from the version shown when it has fields, else from the product's fields.
  const base = shown && typeof shown === "object" ? shown : product;
  // A strategy written on 2 Nov has text, not fields: its sheet edits the text.
  const textMode = typeof base === "string" || base === null || base === undefined;
  const fields = textMode ? [{ name: "text", label: "Text", kind: "lines" as const }] : fieldsOf(sectionKey, base);

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
    current, shown, fields, form, open, saving, notSaved, base,
    /** A 2 Nov text edit, shown in the sheet beside the fields that replace it. */
    earlierText: !textMode && typeof current?.text === "string" && !(current?.value && typeof current.value === "object") ? current.text : null,
    setField: (name: string, v: string) => setForm((f) => ({ ...f, [name]: v })),
    start: () => { setForm(textMode ? { text: typeof shown === "string" ? shown : "" } : toForm(sectionKey, base)); setNotSaved(false); setOpen(true); },
    cancel: () => { setNotSaved(false); setOpen(false); },
    save: () => {
      if (textMode) return send(String(form.text ?? "").trim(), null);
      const value = fromForm(sectionKey, form, base);
      return send(sectionLines(sectionKey, value), value);
    },
    handBack: () => send("", null),
  };
}

export type SectionEditor = ReturnType<typeof useSectionEdit>;

/** The pencil on a card. Never printed. */
export function EditButton({ e, label }: { e: SectionEditor; label: string }) {
  if (!e.fields.length) return null;
  return (
    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={e.start} aria-label={`Edit ${label}`} data-print="hide">
      <Pencil className="h-4 w-4" aria-hidden />
    </Button>
  );
}

/** "Edited by Neria, 4 Nov", on a card a person changed. */
export function EditedChip({ e }: { e: SectionEditor }) {
  if (!e.current) return null;
  return <span className="t-label rounded-full px-2.5 py-0.5 bg-[rgba(255,255,255,0.06)] whitespace-nowrap" data-print="hide">{editedChip(e.current)}</span>;
}
