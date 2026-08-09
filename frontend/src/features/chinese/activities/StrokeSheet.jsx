// Stroke-order practice.
//
// One widget holding a queue, never one widget per character. Ten stacked
// sheets is 4,000px of scroll and ten live canvases; a rail is one canvas and
// reads as a lesson rather than a dump.
//
// Two modes. Watch draws the character stroke by stroke. Trace makes the
// learner draw it, with per-stroke feedback — which is the only mode that
// actually teaches, but never the one to open on, because someone who has
// never seen the character will fail every stroke and feel stupid.
//
// hanzi-writer fetches per-character stroke data from a CDN at runtime, so a
// character can be unavailable even when everything else works. That is handled
// as a state, not an error.
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import HanziWriter from "hanzi-writer";
import { cn } from "@/lib/cn";

export default function StrokeSheet({ activity, onComplete }) {
  // Deduped. 谢谢 and 妈妈 repeat a character, and tracing the same one twice
  // teaches nothing — but more importantly `done` is a Set, so a duplicate made
  // its size permanently smaller than the queue and the sheet could never
  // report itself finished.
  const chars = useMemo(() => {
    const seen = [];
    for (const item of activity.items ?? [])
      for (const c of String(item?.word ?? ""))
        if (/\p{Script=Han}/u.test(c) && !seen.includes(c)) seen.push(c);
    return seen;
  }, [activity.items]);

  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState("watch");
  const [done, setDone] = useState(() => new Set());

  const hostRef = useRef(null);
  const writerRef = useRef(null);
  const char = chars[index];

  // Held in a ref, not read from props inside the effect.
  //
  // The parent renders on every keystroke in the composer, which produced a new
  // `onComplete` each time. That flowed into this component's effect deps and
  // rebuilt the canvas mid-stroke — a learner tracing 谢 lost their work the
  // moment they typed anything. hanzi-writer also has no destroy(), so each
  // rebuild leaked two document listeners that were never released.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  // Fires once, ever. It used to be called from inside a setDone updater, so
  // StrictMode's double-invocation sent two turns for one finished sheet, and
  // re-tracing a completed character sent another.
  const reported = useRef(false);

  // Status and mistakes belong to one character in one mode. Keying them that
  // way lets the effect leave them alone — resetting state at the top of an
  // effect triggers a second render pass before anything has been drawn.
  const sessionKey = `${char}:${mode}`;
  const [session, setSession] = useState({ key: null, status: "loading", mistakes: 0 });
  const current = session.key === sessionKey ? session : { status: "loading", mistakes: 0 };
  const { status, mistakes } = current;

  // Pure updater: it records, and nothing else.
  const finish = useCallback((charDone) => {
    setDone((prev) => (prev.has(charDone) ? prev : new Set(prev).add(charDone)));
  }, []);

  // The side effect lives here, where a replayed render cannot duplicate it.
  useEffect(() => {
    if (reported.current || !chars.length || done.size < chars.length) return;
    reported.current = true;
    onCompleteRef.current?.({
      activityId: activity.id,
      type: "stroke",
      total: chars.length,
      completed: done.size,
    });
  }, [done, chars.length, activity.id]);

  useEffect(() => {
    if (!char || !hostRef.current) return;

    hostRef.current.innerHTML = "";
    let cancelled = false;

    const writer = HanziWriter.create(hostRef.current, char, {
      width: 200,
      height: 200,
      padding: 8,
      showOutline: true,
      showCharacter: mode === "watch",
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 180,
      strokeColor: "#0071e3",
      outlineColor: "#d2d2d7",
      drawingColor: "#0071e3",
      // A character with no stroke data is a fact about that character, not a
      // broken widget — say so and leave the rest of the queue usable.
      onLoadCharDataError: () =>
        !cancelled && setSession({ key: sessionKey, status: "unavailable", mistakes: 0 }),
      onLoadCharDataSuccess: () => {
        if (cancelled) return;
        setSession({ key: sessionKey, status: "ready", mistakes: 0 });

        if (mode === "watch") {
          writer.animateCharacter();
          return;
        }

        writer.quiz({
          onMistake: () => setSession((s) => ({ ...s, mistakes: s.mistakes + 1 })),
          onComplete: () => {
            setSession((s) => ({ ...s, status: "complete" }));
            finish(char);
          },
        });
      },
    });

    writerRef.current = writer;
    return () => {
      cancelled = true;
      // Stops the quiz's pointer handling before the node goes away. There is
      // no destroy() to call, so this is as close to teardown as it offers.
      try {
        writer.cancelQuiz?.();
      } catch {
        /* already gone */
      }
      writerRef.current = null;
    };
  }, [char, mode, sessionKey, finish]);

  if (!chars.length) return null;

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold truncate">{activity.title}</span>
        <span className="text-xs text-muted tabular-nums shrink-0">
          {index + 1} / {chars.length}
        </span>
      </div>

      {/* The rail shows the whole queue from the start, so the shape of the
          exercise is visible before any of it has loaded. */}
      {chars.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-border">
          {chars.map((c, i) => (
            <button
              key={`${c}-${i}`}
              onClick={() => setIndex(i)}
              aria-current={i === index}
              className={cn(
                "shrink-0 w-9 h-9 rounded-[4px] border text-lg grid place-items-center transition-colors cursor-pointer",
                i === index
                  ? "border-primary text-primary"
                  : done.has(c)
                    ? "border-success text-success"
                    : "border-border text-muted hover:text-text",
              )}
              style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 flex flex-col sm:flex-row items-center gap-5">
        <div className="relative shrink-0">
          <div
            ref={hostRef}
            className="w-[200px] h-[200px] rounded-[4px] border border-border bg-bg"
          />
          {status === "loading" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted">
              loading…
            </div>
          )}
          {status === "unavailable" && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <span
                className="text-6xl"
                style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
              >
                {char}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 min-w-0 w-full sm:w-auto">
          {status === "unavailable" ? (
            <p className="text-sm text-muted max-w-xs">
              No stroke animation for {char} — it&rsquo;s a rare one. It&rsquo;s
              shown full size so you can copy it.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("watch")}
                  className={cn(
                    "rounded-btn border px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer",
                    mode === "watch"
                      ? "border-primary text-primary"
                      : "border-border text-muted hover:text-text",
                  )}
                >
                  ▶ Watch
                </button>
                <button
                  onClick={() => setMode("trace")}
                  className={cn(
                    "rounded-btn border px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer",
                    mode === "trace"
                      ? "border-primary text-primary"
                      : "border-border text-muted hover:text-text",
                  )}
                >
                  ✎ Trace
                </button>
              </div>

              {mode === "watch" && status === "ready" && (
                <button
                  onClick={() => writerRef.current?.animateCharacter()}
                  className="self-start text-sm text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
                >
                  replay
                </button>
              )}

              {mode === "trace" && (
                <p className="text-sm text-muted">
                  {status === "complete"
                    ? mistakes === 0
                      ? "Perfect — no mistakes."
                      : `Done, ${mistakes} mistake${mistakes === 1 ? "" : "s"}.`
                    : "Draw the strokes in order."}
                </p>
              )}
            </>
          )}

          {chars.length > 1 && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="rounded-btn border border-border px-3 py-1.5 text-sm text-muted transition-colors cursor-pointer disabled:opacity-30 hover:text-text"
              >
                ← prev
              </button>
              <button
                onClick={() => setIndex((i) => Math.min(chars.length - 1, i + 1))}
                disabled={index === chars.length - 1}
                className="rounded-btn border border-border px-3 py-1.5 text-sm text-muted transition-colors cursor-pointer disabled:opacity-30 hover:text-text"
              >
                next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
