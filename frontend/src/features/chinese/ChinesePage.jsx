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
import { buildContext } from "./history";
import Modal from "@/components/ui/Modal";
import { uid } from "@/lib/utils";

const LEVEL_KEY = "md_hsk_level";

export default function ChinesePage() {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
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

  // The transcript, read the same way and for a sharper version of the same
  // reason: `send` is memoised with an empty dependency list, so closing over
  // `turns` would capture the empty first render forever and every turn would
  // be sent as if it were the first.
  const turnsRef = useRef(turns);

  useEffect(() => {
    levelRef.current = level;
    localStorage.setItem(LEVEL_KEY, String(level));
  }, [level]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

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

    sendTurn(question, levelRef.current, buildContext(turnsRef.current))
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

    sendActivityResult(activity, outcome, levelRef.current, buildContext(turnsRef.current))
      .then((result) => settle({ result }))
      .catch((err) => settle({ error: err?.message || "unavailable" }));
  }, []);

  // Nothing to unwind. The transcript is React state and nothing else: the
  // worker keeps no conversation — every turn is built from one system message
  // and the learner's line — so there is no thread to end and no server call to
  // make. The level survives; it is a setting, not part of the conversation.
  //
  // A request already in flight still resolves, and its `settle` looks for a
  // turn id that is no longer in the list, so it lands as a no-op. Aborting
  // would not save quota either — the worker has already been paid for by then.
  const clear = useCallback(() => {
    setTurns([]);
    setConfirmClear(false);
    inputRef.current?.focus();
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
          {/* Docked with the composer rather than pinned above the transcript,
              which is the one place that is always reachable — a long
              conversation would otherwise put it a scroll away. Absent until
              there is something to clear. */}
          {!empty && (
            <button
              onClick={() => setConfirmClear(true)}
              aria-label="Clear chat"
              title="Clear chat"
              className="shrink-0 w-10 h-10 rounded-btn border border-border text-muted grid place-items-center transition-colors cursor-pointer hover:text-error hover:border-error"
            >
              <i className="fas fa-eraser" />
            </button>
          )}
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

      {/* Confirmed, because the transcript is the only copy. Nothing here is
          written down anywhere, so a mistaken tap is not recoverable — and the
          message says what is kept, since "clear" next to a tab that saves
          decks is a fair thing to be nervous about. */}
      <Modal
        open={confirmClear}
        title="Clear this conversation?"
        message="The answers on screen are removed. Your level and any decks you saved are kept."
        confirmLabel="Clear"
        confirmVariant="danger"
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
