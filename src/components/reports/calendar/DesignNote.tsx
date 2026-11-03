/**
 * A design asked for with a note (notes on regenerate, Lital 3 Nov 2026):
 * while it is prepared, "Your note: ..."; once it is made, "Made with your
 * note: ...". Under it, what the note taught the brand's design memory, with
 * Undo, or "Used for this design only." Nothing shows for what is still being
 * learned, or for a learning step that did not finish.
 */

import { useState } from "react";
import type { DesignRequest } from "@/lib/designRequests";
import { designLearnedLine, undoDesignNote } from "@/lib/postNotes";
import { LearnedNote } from "./NoteBox";
import { useDesignRequests } from "./DesignRequestsContext";

export function DesignNote({ request, brand, made = false }: { request: Pick<DesignRequest, "id" | "note" | "note_learned">; brand?: string | null; made?: boolean }) {
  const ctx = useDesignRequests();
  const [undoing, setUndoing] = useState(false);
  /** The request as Undo answered it, until the shared list catches up. */
  const [answered, setAnswered] = useState<DesignRequest | null>(null);
  const note = request.note?.trim();
  if (!note) return null;
  const learned = (answered?.id === request.id ? answered.note_learned : null) ?? request.note_learned;
  const line = designLearnedLine(learned, brand);
  const undo = async () => {
    setUndoing(true);
    const updated = await undoDesignNote(request.id);
    if (updated) setAnswered(updated);
    setUndoing(false);
    ctx?.refresh();
  };
  return (
    <div className="space-y-1">
      <p className="t-secondary">{made ? "Made with your note" : "Your note"}: "{note}"</p>
      {line && <LearnedNote text={line.text} onUndo={line.undo ? () => void undo() : undefined} undoing={undoing} />}
    </div>
  );
}
