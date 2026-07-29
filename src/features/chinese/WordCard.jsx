// One word, as the dictionary has it.
//
// Every field is dictionary-sourced. Nothing here is written by a model, which
// is deliberate: pinyin, tone, level and measure word are exactly the facts a
// language model gets wrong with confidence.
//
// A card with `found: false` is a real answer, not an error state. Saying "this
// isn't in the HSK list" is the honest result, and it still carries the
// character so the learner can practise writing it.
import Badge from "@/components/ui/Badge";

export default function WordCard({ card, onAsk }) {
  const { word, pinyin, meaning, level, found, traditional, radical, classifiers, frequencyRank } =
    card;

  return (
    <div className="rounded-card border border-border bg-surface p-4 flex flex-col gap-2">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span
          className="text-2xl font-semibold"
          style={{ fontFamily: '"Kaiti SC", "STKaiti", KaiTi, "Songti SC", serif' }}
        >
          {word}
        </span>
        {pinyin && <span className="text-muted">{pinyin}</span>}
        {traditional && traditional !== word && (
          <span className="text-sm text-muted">trad. {traditional}</span>
        )}
        {level ? <Badge>HSK {level}</Badge> : null}
      </div>

      {found ? (
        <>
          <p className="text-sm text-text">{meaning}</p>

          {(radical || classifiers?.length || frequencyRank) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted pt-1">
              {radical && <span>radical {radical}</span>}
              {classifiers?.length ? <span>measure word 一{classifiers[0]}</span> : null}
              {frequencyRank ? <span>#{frequencyRank} most common</span> : null}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          {word} isn&rsquo;t in the HSK vocabulary list, so there&rsquo;s no level or
          meaning for it here. The character above is still correct to practise.
        </p>
      )}

      {onAsk && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => onAsk(`show me how to write ${word}`)}
            className="text-sm text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
          >
            ✎ write it
          </button>
          <span className="text-border">·</span>
          <button
            onClick={() => onAsk(`use ${word} in a sentence`)}
            className="text-sm text-primary font-semibold cursor-pointer bg-transparent border-0 p-0 hover:opacity-80"
          >
            in a sentence
          </button>
        </div>
      )}
    </div>
  );
}
