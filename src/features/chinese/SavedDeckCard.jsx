// The receipt for a save.
//
// A tutor saying "saved!" is a claim. This is the evidence: the deck's name,
// what actually went in, and a way to open it — which also means the learner
// finds out here, not on the deck page, that two words were skipped.
//
// It says Draft because that is the whole promise of this tool. Nothing the
// tutor saves is visible to anyone else until the learner publishes it, and the
// place to say so is next to the thing that was saved.
import { Link } from "react-router";
import Badge from "@/components/ui/Badge";

export default function SavedDeckCard({ save }) {
  const { title, url, added = [], skipped = [], duplicates = [], cardCount } = save;

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <span className="flex items-center gap-2 min-w-0">
          <i className="fas fa-bookmark text-primary text-sm shrink-0" />
          <span className="text-sm font-semibold truncate">{title}</span>
        </span>
        <Badge outline>Draft</Badge>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        <p className="text-sm text-muted">
          {added.length === 0
            ? "Nothing new — those were already in it."
            : `${added.length} word${added.length === 1 ? "" : "s"} added`}
          {cardCount ? ` · ${cardCount} in the deck` : ""}
        </p>

        {added.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {added.map((a) => (
              <span
                key={a.word}
                className="rounded-[4px] border border-border px-2 py-1 text-sm"
                style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}
              >
                {a.word}
              </span>
            ))}
          </div>
        )}

        {/* Said plainly. A skipped word means characters that did not resolve,
            and the learner is the only one who can tell whether that was a typo
            or a word the dictionary simply does not carry. */}
        {skipped.length > 0 && (
          <p className="text-sm text-muted">
            Couldn&rsquo;t look up{" "}
            <span style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}>
              {skipped.join(" ")}
            </span>{" "}
            — not saved.
          </p>
        )}

        {duplicates.length > 0 && (
          <p className="text-sm text-muted">
            Already there:{" "}
            <span style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' }}>
              {duplicates.join(" ")}
            </span>
          </p>
        )}

        <Link
          to={url}
          className="self-start text-sm font-semibold text-primary hover:opacity-80"
        >
          Open deck →
        </Link>
      </div>
    </div>
  );
}
