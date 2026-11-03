/**
 * The box Regenerate opens in place, on a post's Copy (or Message) tab and
 * its Design tab (notes on regenerate, Lital 3 Nov 2026): "What should
 * change? (optional)", with Regenerate and Cancel. An empty box regenerates
 * as before. A regeneration that does not start keeps the note here, with a
 * line that says so.
 */

import { useId } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX } from "@/lib/postNotes";

export function NoteBox({ value, onChange, onSubmit, onCancel, busy, kept, placeholder }: {
  value: string;
  onChange: (note: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  /** Said when the last press did not start, e.g. "Not rewritten yet. Your note is kept here." */
  kept?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="glass-inner p-inner space-y-2">
      <Label htmlFor={id}>What should change? (optional)</Label>
      <Textarea
        id={id}
        rows={3}
        maxLength={NOTE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm"
        autoFocus
      />
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={onSubmit} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          {busy ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        {kept && <span role="status" className="t-secondary">{kept}</span>}
      </div>
    </div>
  );
}

/** What a note taught the brand, under the regeneration it made, with Undo when there is something to take back. */
export function LearnedNote({ text, onUndo, undoing }: { text: string; onUndo?: () => void; undoing?: boolean }) {
  return (
    <p role="status" className="t-secondary">
      {text}
      {onUndo && (
        <>
          {" "}
          <button type="button" onClick={onUndo} disabled={undoing} className="underline underline-offset-2 hover:!text-white disabled:opacity-60">
            Undo
          </button>
        </>
      )}
    </p>
  );
}
