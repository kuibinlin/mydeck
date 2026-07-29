// The 中文 tutor tab.
//
// Composition only: it owns the exchange list and the composer, and nothing
// else. Each answer block renders itself from the floor plan.
//
// Phase 2 is the instant floor — everything here runs in the browser with no
// network call, so the first frame after a submit is already correct and
// useful. Phase 3 adds the turn endpoint that fills the skeletons.
import { useState, useRef, useEffect, useCallback } from "react";
import EmptyState from "./EmptyState";
import AnswerBlock from "./AnswerBlock";
import { floorPlan } from "./floorPlan";
import { sendTurn, sendActivityResult } from "./chineseApi";
import { uid } from "@/lib/utils";

const LEVEL_KEY = "md_hsk_level";

export default function ChinesePage() {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [level, setLevel] = useState(() => {
    const saved = Number(localStorage.getItem(LEVEL_KEY));
    return saved >= 1 && saved <= 6 ? saved : 3;
  });

  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Read through a ref rather than closed over. `onActivityDone` ends up in
  // StrokeSheet's effect deps, so a new identity mid-trace would tear down the
  // canvas the learner is drawing on — changing the level must not do that.
  const levelRef = useRef(level);

  useEffect(() => {
    levelRef.current = level;
    localStorage.setItem(LEVEL_KEY, String(level));
  }, [level]);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  const send = useCallback((text) => {
    const question = text.trim();
    if (!question) return;

    const id = uid();
    const floor = floorPlan(question);

    // Painted on this frame. No await, no request, nothing to wait for — the
    // answer is on screen before the network has been touched.
    setTurns((prev) => [...prev, { id, question, floor, result: null, error: null }]);
    setDraft("");
    inputRef.current?.focus();

    // Some answers are complete already: an empty box, or a language this tab
    // doesn't do. Asking the server would only add latency to a settled answer.
    if (!floor.needsServer) return;

    const settle = (patch) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

    sendTurn(question, levelRef.current)
      .then((result) => settle({ result }))
      // The floor stays exactly as painted; only the enrichment is lost.
      .catch((err) => settle({ error: err?.message || "unavailable" }));
  }, []);

  // An activity finishing opens a new block with no question attached — nobody
  // asked anything, the tutor noticed. That absence is the whole effect; echoing
  // "I scored 6/10" as if the learner typed it turns it back into a form.
  const onActivityDone = useCallback((activity, outcome) => {
    const id = uid();

    setTurns((prev) => [
      ...prev,
      {
        id,
        question: null,
        floor: {
          showChars: [],
          skeleton: "none",
          skeletonRows: 0,
          // Pre-seeded with what the client already knows, so the block is
          // never an empty box while the model thinks.
          status: outcome.misses?.length
            ? `Looking at ${outcome.misses.length === 1 ? "the one" : `those ${outcome.misses.length}`} you missed…`
            : "Nice — looking at how that went…",
          chips: [],
          needsServer: true,
        },
        result: null,
        error: null,
      },
    ]);

    const settle = (patch) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

    sendActivityResult(activity, outcome, levelRef.current)
      .then((result) => settle({ result }))
      .catch((err) => settle({ error: err?.message || "unavailable" }));
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  const empty = turns.length === 0;

  return (
    // Fills whatever ProtectedRoute's `bare` variant hands down. The scroll
    // lives on the inner region so the composer stays docked.
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* Everything in this tab arrives without focus moving: the answer
            appears somewhere the learner is not looking, and for a screen
            reader that is silence. `log` is the role for an append-only
            transcript — it implies a polite live region and announces added
            nodes only, so the answer filling into a block that is already
            there is read out, while the blocks above it are not re-read. */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Tutor answers"
          className="max-w-3xl mx-auto w-full px-4 py-8 flex flex-col gap-8"
        >
          {empty ? (
            <EmptyState level={level} onLevel={setLevel} onSend={send} />
          ) : (
            turns.map((t) => (
              <AnswerBlock
                key={t.id}
                question={t.question}
                floor={t.floor}
                result={t.result}
                error={t.error}
                onChip={send}
                onActivityDone={onActivityDone}
              />
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-border bg-bg">
        <div className="max-w-3xl mx-auto w-full px-4 py-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about a word, or paste some Chinese…"
            aria-label="Ask the tutor"
            className="flex-1 resize-none bg-surface border border-border rounded-input px-3.5 py-2.5 text-text text-[15px] leading-6 max-h-32 focus:outline-none focus:border-primary transition-colors"
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim()}
            aria-label="Send"
            className="shrink-0 w-10 h-10 rounded-btn bg-primary text-white grid place-items-center transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-primary-hover"
          >
            <i className="fas fa-arrow-up" />
          </button>
        </div>
      </div>
    </div>
  );
}
