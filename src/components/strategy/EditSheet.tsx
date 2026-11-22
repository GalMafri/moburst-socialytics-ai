/**
 * The sheet a card's pencil opens: the card's fields (a title input, list
 * items one per line, a picker beside each competitor or platform line), Save,
 * and "Go back to the written version" over a person's version. A 2 Nov text
 * edit, and goals the strategy no longer has, are shown above the fields that
 * replace them, so nothing a person wrote is out of sight. A line with only
 * one half filled in cannot be saved: Save waits, and the empty half is
 * outlined with a line beside it saying what is missing. Earlier goals each
 * have a Remove button.
 */

import { Loader2, Plus, Save, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { missingHalf, overCap, type Field, type Pair } from "@/lib/strategyForms";
import type { SectionEditor } from "./StrategySection";

const INVALID_CLASS = "border-destructive ring-1 ring-destructive/60";
const SELECT_CLASS = "flex h-10 w-full sm:w-48 shrink-0 input-glass rounded-xl text-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(185,224,69,0.3)] md:text-sm";

/** A list of lines, each with a picker (a competitor, a platform) beside what is written about it. */
function PairRows({ f, id, rows, onChange }: { f: Field; id: string; rows: Pair[]; onChange: (rows: Pair[]) => void }) {
  const set = (i: number, patch: Partial<Pair>) => onChange(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  const what = (f.pickLabel ?? "Choice").toLowerCase();
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        // A pick the strategy already holds stays choosable even when it is not in the list.
        const half = missingHalf(r);
        const said = half && f.incomplete ? f.incomplete[half] : null;
        const sayId = `${id}-missing-${i}`;
        const options = r.pick && !(f.options ?? []).includes(r.pick) ? [r.pick, ...(f.options ?? [])] : f.options ?? [];
        return (
          <div key={i} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
            <select id={i === 0 ? id : undefined} aria-label={`${f.pickLabel} ${i + 1}`} required={half === "pick"} aria-invalid={half === "pick" || undefined} aria-describedby={half === "pick" && said ? sayId : undefined} className={cn(SELECT_CLASS, half === "pick" && INVALID_CLASS)} value={r.pick} onChange={(ev) => set(i, { pick: ev.target.value })}>
              <option value="">Choose a {what}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <Textarea aria-label={`${f.label} ${i + 1}`} required={half === "text"} aria-invalid={half === "text" || undefined} aria-describedby={half === "text" && said ? sayId : undefined} value={r.text} onChange={(ev) => set(i, { text: ev.target.value.replace(/\s*\n+\s*/g, " ") })} rows={2} className={cn("t-body min-w-0", half === "text" && INVALID_CLASS)} />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove ${what} ${i + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== i))}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
            {said && <p id={sayId} className="t-label text-destructive sm:basis-full">{said}</p>}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, { pick: "", text: "" }])}>
        <Plus aria-hidden /> Add a line
      </Button>
    </div>
  );
}

export function EditSheet({ e, title }: { e: SectionEditor; title: string }) {
  const long = overCap(e.fields, e.form);
  return (
    // QA 22 Nov 2026: the sheet stays open while a save is sent (as Cancel is disabled then). Closed over a
    // save that then did not get through, its "not saved yet" line was inside a closed sheet and the
    // words typed were gone when the pencil was pressed again.
    <Sheet open={e.open} onOpenChange={(open) => { if (!open && !e.saving) e.cancel(); }}>
      <SheetContent className="w-full sm:max-w-[560px] overflow-y-auto space-y-5">
        <SheetHeader>
          <SheetTitle className="t-h2">{title}</SheetTitle>
          <SheetDescription className="t-secondary">Your wording is kept when the strategy is written again.{e.keepsFigures ? " Numbers and dates stay current." : ""}</SheetDescription>
        </SheetHeader>
        {e.earlierText && (
          <div className="glass-inner p-inner space-y-1.5">
            <p className="t-subhead">{e.earlierFromClaude ? "The version saved from the connector" : "Your team's earlier version"}</p>
            <p className="t-read whitespace-pre-line">{e.earlierText}</p>
          </div>
        )}
        {e.earlierGoals.length > 0 && (
          <div className="glass-inner p-inner space-y-1.5">
            <p className="t-subhead">Your earlier goals</p>
            <p className="t-label">They are kept when you save, until you remove them.</p>
            <ul className="space-y-1.5">
              {e.earlierGoals.map((g, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="t-read min-w-0 flex-1">{[g.title, g.why].filter(Boolean).join(". ")}</span>
                  <Button type="button" size="sm" variant="ghost" className="shrink-0" aria-label={`Remove earlier goal ${i + 1}`} onClick={() => e.removeEarlier(i)}>Remove</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-4">
          {e.fields.map((f) => {
            const id = `strategy-field-${f.name}`;
            return (
              <div key={f.name} className="space-y-1.5">
                <Label htmlFor={id}>{f.label}</Label>
                {f.kind === "pairs" ? (
                  <PairRows f={f} id={id} rows={Array.isArray(e.form[f.name]) ? (e.form[f.name] as Pair[]) : []} onChange={(rows) => e.setField(f.name, rows)} />
                ) : f.kind === "lines" ? (
                  <Textarea id={id} value={String(e.form[f.name] ?? "")} onChange={(ev) => e.setField(f.name, ev.target.value)} rows={f.name === "text" ? 12 : 5} className="t-body" />
                ) : f.kind === "input" && (f.max ?? 0) >= 100 ? (
                  // A one-line field long enough to wrap shows all of itself; it stays one line.
                  <Textarea id={id} value={String(e.form[f.name] ?? "")} onChange={(ev) => e.setField(f.name, ev.target.value.replace(/\s*\n+\s*/g, " "))} rows={2} className="t-body" />
                ) : (
                  <Input id={id} type={f.kind === "number" ? "number" : "text"} inputMode={f.kind === "number" ? "numeric" : undefined} value={String(e.form[f.name] ?? "")} onChange={(ev) => e.setField(f.name, ev.target.value)} />
                )}
                {(f.hint || long[f.name]) && (
                  <p className="t-label">{[f.hint ? `${f.hint}.` : "", long[f.name] ? `A line has ${long[f.name]} characters. Keep each line to ${f.max} characters.` : ""].filter(Boolean).join(" ")}</p>
                )}
              </div>
            );
          })}
        </div>
        {e.notSaved && <p role="status" className="t-label">Your changes are kept here and are not saved yet.</p>}
        <SheetFooter className="flex-wrap gap-2 sm:justify-start">
          <Button onClick={() => void e.save()} disabled={e.saving || !!e.issue}>
            {e.saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          {e.current && (
            <Button variant="outline" onClick={() => void e.handBack()} disabled={e.saving}>Go back to the written version</Button>
          )}
          <Button variant="ghost" onClick={e.cancel} disabled={e.saving}>Cancel</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
