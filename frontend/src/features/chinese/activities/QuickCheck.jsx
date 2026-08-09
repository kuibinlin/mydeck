// A short matching round — the thing that produces a result worth reacting to.
//
// No library, no arcade. The point is not the game, it is the score and the
// list of what was missed: that payload is what turns the tutor from a
// dictionary into something that notices.
//
// Distractors come from the round's own items, so they are always plausible and
// always at the learner's level. The service has already guaranteed no two
// items share a meaning, which is what stops a correct answer being marked
// wrong.
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";

const CHOICES = 4;

// Seeded so a re-render never reshuffles the board mid-round.
function shuffle(list, seed) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function QuickCheck({ activity, onComplete }) {
  // Memoised because a fresh [] each render would reshuffle the board.
  const items = useMemo(() => activity.items ?? [], [activity.items]);

  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const [misses, setMisses] = useState([]);
  const [correct, setCorrect] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);

  // Same reasoning as StrokeSheet: the parent re-renders on every keystroke, so
  // the prop identity is not stable enough to depend on.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  // Answering the last question starts a 700ms timer. Leaving the page before
  // it fires used to still send the turn — a full agent run, billed, for a page
  // the learner had already left.
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const item = items[index];

  const choices = useMemo(() => {
    if (!item) return [];
    const others = items.filter((i) => i.word !== item.word);
    const distractors = shuffle(others, index + 1).slice(0, CHOICES - 1);
    return shuffle([item, ...distractors], index + 7);
  }, [item, items, index]);

  const answer = useCallback(
    (choice) => {
      if (picked) return;
      setPicked(choice);

      const right = choice.word === item.word;
      if (right) setCorrect((c) => c + 1);
      else setMisses((m) => [...m, { word: item.word, chose: choice.word }]);

      // A beat to read the feedback, then move on. Long enough to register,
      // short enough not to break the rhythm of a drill.
      timer.current = setTimeout(() => {
        setPicked(null);
        if (index + 1 < items.length) {
          setIndex((i) => i + 1);
        } else {
          setFinished(true);
          onCompleteRef.current?.({
            activityId: activity.id,
            type: "match",
            total: items.length,
            correct: right ? correct + 1 : correct,
            seconds: Math.round((Date.now() - startedAt) / 1000),
            misses: right ? misses : [...misses, { word: item.word, chose: choice.word }],
          });
        }
      }, 700);
    },
    [picked, item, index, items.length, correct, misses, startedAt, activity.id],
  );

  if (!items.length) return null;

  // Collapses in place rather than being replaced, so the thing the learner
  // just used stays in the transcript.
  if (finished) {
    const score = `${correct} / ${items.length}`;
    return (
      <div className="rounded-card border border-border bg-surface px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-semibold">{activity.title} · complete</span>
        <span className="text-sm tabular-nums">{score}</span>
        {misses.length > 0 && (
          <span className="text-sm text-muted">
            missed{" "}
            <span style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}>
              {misses.map((m) => m.word).join(" ")}
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold truncate">{activity.title}</span>
        <span className="text-xs text-muted tabular-nums shrink-0">
          {index + 1} / {items.length}
        </span>
      </div>

      <div className="p-5 flex flex-col items-center gap-5">
        <div className="text-center">
          <p
            className="text-4xl font-semibold"
            style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
          >
            {item.word}
          </p>
          {item.pinyin && <p className="text-sm text-muted mt-1">{item.pinyin}</p>}
        </div>

        <div className="grid gap-2 w-full sm:grid-cols-2">
          {choices.map((c) => {
            const isPicked = picked?.word === c.word;
            const isAnswer = c.word === item.word;
            return (
              <button
                key={c.word}
                onClick={() => answer(c)}
                disabled={Boolean(picked)}
                className={cn(
                  "rounded-btn border px-3.5 py-2.5 text-sm text-left transition-colors",
                  !picked && "border-border hover:border-primary hover:text-primary cursor-pointer",
                  picked && isAnswer && "border-success text-success",
                  picked && isPicked && !isAnswer && "border-error text-error",
                  picked && !isAnswer && !isPicked && "border-border opacity-40",
                )}
              >
                {c.meaning}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
