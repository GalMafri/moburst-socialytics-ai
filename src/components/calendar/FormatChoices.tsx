/**
 * A new post's format, as a row of choices (Stories you can find, Lital
 * 3 Nov 2026): Story is always one of them when the client has Instagram or
 * Facebook, and choosing it narrows the platforms to those
 * (NewPostDialog.tsx).
 */

export function FormatChoices({ choices, value, onChange }: { choices: Array<{ value: string; label: string }>; value: string; onChange: (format: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Format" className="flex flex-wrap gap-1.5">
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c.value)}
            className={`h-8 px-3 rounded-full border t-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? "border-primary/70 bg-[rgba(185,224,69,0.10)] !text-white" : "border-white/15 hover:border-white/30"}`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
