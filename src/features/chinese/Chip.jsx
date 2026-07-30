// One tappable next step.
//
// The label is Chinese and the gloss under it is English, and both are
// load-bearing. This is a tab for reading Chinese, so a row of English buttons
// is a row of things that teach nothing — but an HSK 1 learner who cannot yet
// read 加入卡组 needs to know what the button does before pressing it, not after.
//
// The label is deliberately not set in Kaiti. The character being *studied* is
// rendered in a calligraphic face by CharacterBox; the same face on UI chrome
// reads as decoration and is harder to scan at 14px.
import { cn } from "@/lib/cn";

/**
 * @param {object} props
 * @param {string} props.label            Chinese — what pressing this does
 * @param {string} [props.hint]           English gloss, one short phrase
 * @param {() => void} props.onClick
 * @param {"solid"|"quiet"} [props.variant]  bordered on its own row, or bare
 *                                           inside a card that already has one
 */
export default function Chip({ label, hint, onClick, variant = "solid" }) {
  const solid = variant === "solid";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-0.5 text-left transition-colors cursor-pointer",
        solid
          ? "rounded-btn border border-border bg-surface px-3 py-1.5 hover:border-primary"
          : "border-0 bg-transparent p-0 hover:opacity-80",
      )}
    >
      {/* Tagged, so a screen reader switches voice rather than reading the
          characters out through an English one. */}
      <span
        lang="zh-Hans"
        className={cn(
          "text-sm font-semibold leading-tight",
          solid ? "text-text group-hover:text-primary" : "text-primary",
        )}
      >
        {label}
      </span>
      {hint && <span className="text-[11px] leading-tight text-muted">{hint}</span>}
    </button>
  );
}
