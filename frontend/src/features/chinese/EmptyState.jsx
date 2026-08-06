// The tab before anything is typed.
//
// A blank page with a text box asks the learner to know what to ask, which most
// don't. Four elements fix that: the composer as hero, a level that persists
// and removes a whole clarifying round trip, three prompts that demonstrate
// what the tab can do, and one character worth learning today.
//
// Today's character costs nothing — a date-seeded pick from a bundled list, no
// model call. An empty state that burns AI quota is a bad empty state.
import { useMemo } from "react";
import CharacterBox from "./CharacterBox";
import { SEED_CHARS } from "./data/seedChars";
import { cn } from "@/lib/cn";

const LEVELS = [1, 2, 3, 4, 5, 6];

// One prompt per capability, so the row teaches the shape of the tab rather
// than listing features.
const SUGGESTIONS = [
  { han: "字", title: "Stroke order", prompt: "how do I write 谢?" },
  { han: "级", title: "Check a level", prompt: "what HSK level is 改革?" },
  { han: "卡", title: "Build a deck", prompt: "give me 10 HSK 3 words" },
];

function characterOfTheDay() {
  const today = new Date();
  const key = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return SEED_CHARS[key % SEED_CHARS.length];
}

export default function EmptyState({ level, onLevel, onSend }) {
  const today = useMemo(() => characterOfTheDay(), []);

  return (
    <div className="flex flex-col gap-10">
      <div className="text-center flex flex-col gap-2">
        <h2 className="text-2xl font-bold">你好 — what shall we study today?</h2>
        <p className="text-muted text-sm">
          Ask about a character, a word, or paste a whole sentence.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <span className="text-xs uppercase tracking-wider text-muted font-semibold">
          Your level
        </span>
        <div className="flex gap-1.5">
          {LEVELS.map((n) => (
            <button
              key={n}
              onClick={() => onLevel(n)}
              aria-pressed={level === n}
              className={cn(
                "w-10 h-10 rounded-btn border text-sm font-semibold transition-all cursor-pointer",
                level === n
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-muted hover:text-text hover:border-muted",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          So “give me some words” already means something.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onSend(s.prompt)}
            className="rounded-card border border-border bg-surface p-4 text-left transition-all cursor-pointer hover:shadow-hover hover:-translate-y-px"
          >
            <span
              className="block text-2xl mb-2 text-primary"
              style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
            >
              {s.han}
            </span>
            <span className="block font-semibold text-sm mb-1">{s.title}</span>
            <span className="block text-xs text-muted">“{s.prompt}”</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-wider text-muted font-semibold">
          Today&rsquo;s character
        </span>
        <div className="rounded-card bg-surface shadow-card p-5 flex items-center gap-5">
          <CharacterBox char={today.w} size="lg" />
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-lg font-semibold">
              {today.w} <span className="text-muted font-normal">{today.p}</span>
            </p>
            <p className="text-sm text-muted truncate">{today.m}</p>
            <button
              onClick={() => onSend(`show me how to write ${today.w}`)}
              className="self-start mt-1 text-sm text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
            >
              ✎ practise writing it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
