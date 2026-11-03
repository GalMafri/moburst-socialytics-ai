/**
 * The sheet a card's pencil opens: the card's fields (a title input, list
 * items one per line), Save, and "Use the product's version" over a person's
 * version. A 2 Nov text edit is shown above the fields that replace it, so
 * nothing a person wrote is out of sight while they move it to the new form.
 */

import { Loader2, Save } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { overCap } from "@/lib/strategyForms";
import type { SectionEditor } from "./StrategySection";

export function EditSheet({ e, title }: { e: SectionEditor; title: string }) {
  const long = overCap(e.fields, e.form);
  return (
    <Sheet open={e.open} onOpenChange={(open) => { if (!open) e.cancel(); }}>
      <SheetContent className="w-full sm:max-w-[560px] overflow-y-auto space-y-5">
        <SheetHeader>
          <SheetTitle className="t-h2">{title}</SheetTitle>
          <SheetDescription className="t-secondary">Your version is kept when the strategy is written again.</SheetDescription>
        </SheetHeader>
        {e.earlierText && (
          <div className="glass-inner p-inner space-y-1.5">
            <p className="t-subhead">Your team's earlier version</p>
            <p className="t-read whitespace-pre-line">{e.earlierText}</p>
          </div>
        )}
        <div className="space-y-4">
          {e.fields.map((f) => {
            const id = `strategy-field-${f.name}`;
            return (
              <div key={f.name} className="space-y-1.5">
                <Label htmlFor={id}>{f.label}</Label>
                {f.kind === "lines" ? (
                  <Textarea id={id} value={e.form[f.name] ?? ""} onChange={(ev) => e.setField(f.name, ev.target.value)} rows={f.name === "text" ? 12 : 5} className="t-body" />
                ) : (
                  <Input id={id} type={f.kind === "number" ? "number" : "text"} inputMode={f.kind === "number" ? "numeric" : undefined} value={e.form[f.name] ?? ""} onChange={(ev) => e.setField(f.name, ev.target.value)} />
                )}
                {(f.hint || long[f.name]) && (
                  <p className="t-label">{[f.hint, long[f.name] ? `A line has ${long[f.name]} characters; the strategy keeps each to ${f.max}.` : ""].filter(Boolean).join(". ")}</p>
                )}
              </div>
            );
          })}
        </div>
        {e.notSaved && <p role="status" className="t-label">Your changes are kept here and are not saved yet.</p>}
        <SheetFooter className="flex-wrap gap-2 sm:justify-start">
          <Button onClick={() => void e.save()} disabled={e.saving}>
            {e.saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          {e.current && (
            <Button variant="outline" onClick={() => void e.handBack()} disabled={e.saving}>Use the product's version</Button>
          )}
          <Button variant="ghost" onClick={e.cancel} disabled={e.saving}>Cancel</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
