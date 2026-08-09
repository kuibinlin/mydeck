// A character in a 田字格 — the crosshair grid Chinese is learned to write in.
//
// Pure CSS, no library, no data fetch. This is the first thing on screen after
// a submit, and it is the reason the tab never shows an empty box: whatever
// else fails, the learner's own characters render correctly and immediately.
import { cn } from "@/lib/cn";

export default function CharacterBox({ char, size = "md", className = "" }) {
  const dims = {
    sm: "w-11 h-11 text-2xl",
    md: "w-20 h-20 text-5xl",
    lg: "w-28 h-28 text-7xl",
  }[size];

  return (
    <div
      className={cn(
        "relative shrink-0 grid place-items-center border border-border rounded-[4px] bg-surface select-none",
        dims,
        className,
      )}
    >
      {/* The crosshair. Dashed and faint so it guides without competing with
          the stroke it is there to place. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, transparent calc(50% - 0.5px), currentColor calc(50% - 0.5px), currentColor calc(50% + 0.5px), transparent calc(50% + 0.5px))," +
            "linear-gradient(to bottom, transparent calc(50% - 0.5px), currentColor calc(50% - 0.5px), currentColor calc(50% + 0.5px), transparent calc(50% + 0.5px))",
          color: "var(--color-border)",
        }}
      />
      <span
        className="relative leading-none"
        style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, "Songti SC", serif' }}
      >
        {char}
      </span>
    </div>
  );
}
