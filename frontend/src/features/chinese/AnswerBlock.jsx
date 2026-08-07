// One exchange: what the learner asked, and everything that arrives in answer.
//
// Renders in three passes. The floor paints on the submitting frame from the
// classification alone. The grounded card replaces its skeleton when the
// dictionary answers. The tutor's prose fills a slot that was reserved from the
// start, so nothing that arrives later moves what already arrived.
//
// Until the turn endpoint exists (phase 3) the skeleton is where it stops —
// which is exactly what this looks like at t=16ms in production.
import CharacterBox from "./CharacterBox";
import Chip from "./Chip";
import WordCard from "./WordCard";
import ActivityCard from "./ActivityCard";
import SavedDeckCard from "./SavedDeckCard";
import { cn } from "@/lib/cn";

// Purely a reserved shape — hidden from assistive tech, which has the status
// line for the same information and nothing to gain from the placeholder rows.
function Skeleton({ shape, rows }) {
  if (shape === "none") return null;

  if (shape === "card") {
    return (
      <div
        aria-hidden="true"
        className="rounded-card border border-border bg-surface p-4 flex flex-col gap-2.5"
      >
        <div className="h-3.5 w-28 rounded bg-surface-alt animate-pulse" />
        <div className="h-3 w-full max-w-md rounded bg-surface-alt animate-pulse" />
        <div className="h-3 w-40 rounded bg-surface-alt animate-pulse" />
      </div>
    );
  }

  // Row count comes from the request, so ten words reserve ten rows. A
  // three-row skeleton that becomes ten is a lie that costs a reflow.
  return (
    <div
      aria-hidden="true"
      className="rounded-card border border-border bg-surface divide-y divide-border"
    >
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-4 w-10 rounded bg-surface-alt animate-pulse" />
          <div className="h-3 w-20 rounded bg-surface-alt animate-pulse" />
          <div className="h-3 flex-1 max-w-[14rem] rounded bg-surface-alt animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function AnswerBlock({ question, floor, result, error, onChip, onActivityDone }) {
  const settled = Boolean(result) || Boolean(error);
  const cards = result?.cards ?? [];
  const activities = result?.agent?.activities ?? [];
  const saves = result?.agent?.saves ?? [];
  const reply = result?.agent?.text;
  // A word from this turn that the dictionary actually knows — the only kind a
  // retry can save, since the save reads the words the message resolved.
  const savable = cards.find((c) => c.found)?.word;
  return (
    // aria-busy so the live region above says "loading" rather than announcing
    // a half-built answer as if it were the whole one.
    <section
      aria-busy={!settled}
      className="flex flex-col gap-4"
      style={{ animation: "var(--animate-fade-in-up)" }}
    >
      {/* The question, as an aside rather than a peer — the answer is the page.
          Omitted entirely when nobody asked anything: an activity finishing
          produces a reply with no question, and inventing one would turn the
          tutor noticing into the learner filling in a form. */}
      {question && (
        <div className="flex justify-end">
          <p className="max-w-[70%] rounded-2xl bg-surface-alt px-3.5 py-2 text-sm text-text">
            {question}
          </p>
        </div>
      )}

      <div className="rounded-card bg-surface shadow-card p-5 flex flex-col gap-4">
        {floor.showChars.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {floor.showChars.map((c, i) => (
              <CharacterBox key={`${c}-${i}`} char={c} size={floor.showChars.length > 6 ? "sm" : "md"} />
            ))}
          </div>
        )}

        {/* The status line is a promise about what is coming. Once something
            has arrived it has served its purpose and would only be noise. */}
        {floor.status && !settled && (
          <p className={cn("text-sm", floor.needsServer ? "text-muted" : "text-text")}>
            {floor.needsServer && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-2 align-middle animate-pulse" />
            )}
            {floor.status}
          </p>
        )}
        {floor.status && settled && !floor.needsServer && (
          <p className="text-sm text-text">{floor.status}</p>
        )}

        {floor.needsServer && !settled && (
          <Skeleton shape={floor.skeleton} rows={floor.skeletonRows} />
        )}

        {/* The tutor's line goes above the cards: it frames them, and putting
            it below would make the learner scroll past the data to find out
            what it was for. */}
        {reply && <p className="text-[15px] leading-relaxed">{reply}</p>}

        {cards.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {cards.map((card, i) => (
              <WordCard
                key={`${card.word}-${i}`}
                card={card}
                // Withheld for a single card: the chip row below is already
                // about that word and offers the same two actions plus a third.
                // In a list they are the only per-word actions there are.
                onAsk={cards.length > 1 ? onChip : undefined}
              />
            ))}
          </div>
        )}

        {activities.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            onComplete={(r) => onActivityDone?.(activity, r)}
          />
        ))}

        {saves.map((save) => (
          <SavedDeckCard key={save.deckId} save={save} />
        ))}

        {/* The reply is not evidence of a write. Measured twice: told the save
            had failed, the model still said "I've added it to your deck" — and
            on the first real agent run it reported a save it had never even
            attempted. The server reports what actually landed, and when nothing
            did, that is said here rather than left to the prose.

            No cause is named, because the server knows the outcome and not the
            reason: the characters may have failed to resolve, or the model may
            have claimed a save it never made. Asserting either would be wrong
            half the time.

            The retry has to name a word. "save that to a deck" is all Latin, so
            it resolves no characters, so the save has nothing to work with —
            offering it here sent the learner round the same loop forever. */}
        {result?.agent?.saveFailed && (
          <p className="text-sm rounded-card border border-border bg-surface-alt px-3.5 py-2.5">
            Nothing was saved to a deck.
            {savable ? (
              <>
                {" "}
                Try{" "}
                <button
                  onClick={() => onChip(`save ${savable} to a deck`)}
                  className="text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
                >
                  save {savable} to a deck
                </button>
                .
              </>
            ) : (
              " Look a word up first, then ask to save it."
            )}
          </p>
        )}

        {/* Same job as saveFailed, for the other thing that can be claimed and
            not happen. It only ever appears on the remote agent path: there the
            activity is built after the loop ends, so the reply was written
            before anyone knew it had failed and cannot mention it. The local
            loop hands the error back to the model mid-run, which says so in its
            own words — hence the flag is false there rather than doubling up. */}
        {result?.agent?.activityFailed && (
          <p className="text-sm rounded-card border border-border bg-surface-alt px-3.5 py-2.5">
            I couldn&rsquo;t build that practice round &mdash; there weren&rsquo;t enough words
            with distinct meanings to make it work. Look up a few more and ask again.
          </p>
        )}

        {result?.misses?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.misses.map((word) => (
              <button
                key={word}
                onClick={() => onChip(`show me how to write ${word}`)}
                className="rounded-btn border border-border px-3 py-1.5 text-sm transition-colors cursor-pointer hover:border-primary hover:text-primary"
                style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
              >
                ✎ {word}
              </button>
            ))}
          </div>
        )}

        {/* Never a bare error. The characters and chips above are still on
            screen and still useful; this explains what is missing and what
            still works, and offers a way forward. */}
        {error && (
          <p className="text-sm text-muted rounded-card border border-border bg-surface-alt px-3.5 py-2.5">
            {/* The real reason, not a guess. apiClient turns a 401 into "Please
                sign in again" and a 429 into "try again in a moment"; printing
                "the dictionary didn't answer" over the top of those sent the
                learner to retry a request that could never succeed. */}
            {error}
            {floor.showChars.length > 0 && " The characters above are still correct to practise."}
            {/* Only offered when there is something to retry. An activity result
                has no question, and passing null here threw. */}
            {question && (
              <>
                {" "}
                <button
                  onClick={() => onChip(question)}
                  className="text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
                >
                  Try again
                </button>
              </>
            )}
          </p>
        )}

        {/* Painted on the submitting frame and never removed. Chips that
            vanished once the card arrived would move everything under them,
            which is the one thing this block is built not to do — so where they
            would duplicate the card's own actions, it is the card that stays
            quiet (see the `onAsk` gate above). */}
        {floor.chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {floor.chips.map((chip) => (
              <Chip
                key={chip.send}
                label={chip.label}
                hint={chip.hint}
                onClick={() => onChip(chip.send)}
              />
            ))}
          </div>
        )}

        {/* Phase 4 replaces this with the tutor's own line. Until then, saying
            the cards came from the dictionary is both true and the more
            trustworthy claim. */}
        {settled && cards.length > 0 && (
          <p className="text-xs text-muted border-t border-border pt-3">
            From the HSK dictionary
            {result?.sources?.includes("bundle") && !result?.sources?.includes("server")
              ? " — offline copy, so some detail is missing"
              : ""}
            .
          </p>
        )}

        {/* Said plainly rather than hidden.
            This used to be gated on `cards.length > 0` — which is precisely
            when it could not fire. An English question ("make me a game")
            resolves no cards, so hitting the daily limit rendered an empty
            white box: no status, no skeleton, no reply, no explanation. The
            message matters most exactly when there is nothing else to show. */}
        {result?.agent?.unavailable && (
          <p
            className={cn(
              "text-muted",
              cards.length > 0 ? "text-xs border-t border-border pt-3" : "text-sm",
            )}
          >
            {result.agent.reason === "quota"
              ? "You've used today's AI practice — lookups and your decks still work."
              : "The tutor's notes aren't available right now."}
          </p>
        )}

        {/* Last resort. Everything above can legitimately render nothing —
            an empty agent reply, no cards, no chips — and an answer block that
            renders nothing at all reads as a broken page rather than an answer. */}
        {settled && !reply && !cards.length && !activities.length && !saves.length &&
          !error && !result?.agent?.unavailable && !result?.misses?.length &&
          !result?.agent?.saveFailed && !result?.agent?.activityFailed && (
            <p className="text-sm text-muted">
              Nothing came back for that one. Try a Chinese word or character.
            </p>
          )}
      </div>
    </section>
  );
}
