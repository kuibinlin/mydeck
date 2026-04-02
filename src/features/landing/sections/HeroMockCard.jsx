import { useState, useEffect } from "react";

const CARDS = [
  {
    front: "自强不息\n(zì qiáng bù xī)",
    back: "Constantly strive to become stronger",
    note: '《周易·乾卦》— "天行健，君子以自强不息。"\n(The Book of Changes, Qian Hexagram)',
  },
  {
    front: "Interest Rate Cut",
    back: "A reduction in the central bank's benchmark interest rate, usually to stimulate economic activity.",
    note: "Lower rates make loans cheaper — think of it as giving the economy a caffeine boost.",
  },
  {
    front: "Gradient Descent",
    back: "An optimization algorithm used to minimize a function by iteratively moving in the direction of the steepest decrease of the function.",
  },
];

export default function HeroMockCard() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const flipTimer = setTimeout(() => setFlipped(true), 1500);
    const fadeTimer = setTimeout(() => setFading(true), 3000);
    const nextTimer = setTimeout(() => {
      setFading(false);
      setFlipped(false);
      setIndex((i) => (i + 1) % CARDS.length);
    }, 3600);

    return () => {
      clearTimeout(flipTimer);
      clearTimeout(fadeTimer);
      clearTimeout(nextTimer);
    };
  }, [index, paused]);

  const handleMouseEnter = () => {
    setPaused(true);
    setFading(false);
  };

  const handleMouseLeave = () => {
    setFlipped(false);
    setFading(false);
    setPaused(false);
  };

  const goTo = (i) => {
    setFlipped(false);
    setFading(false);
    setIndex(i);
  };

  const card = CARDS[index];
  const progress = Math.round(((index + 1) / CARDS.length) * 100);

  return (
    <div
      className="w-full aspect-[4/3] rounded-card shadow-card flex flex-col gap-4 p-6"
      style={{
        background: "linear-gradient(135deg, #818cf8 0%, #22d3ee 100%)",
        cursor: paused ? "pointer" : "default",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Flip card */}
      <div
        style={{
          perspective: "1000px",
          flex: 1,
          opacity: fading ? 0 : 1,
          transition: "opacity 0.5s ease",
        }}
        onClick={() => paused && setFlipped((f) => !f)}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            transformStyle: "preserve-3d",
            transition: "transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* Front — question */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.25)",
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-3 px-6"
          >
            <p
              className="text-base font-semibold text-white text-center"
              style={{ whiteSpace: "pre-line" }}
            >
              {card.front}
            </p>
            <span className="text-xs text-white/60 tracking-wide">
              {paused ? "click to flip" : "flip to reveal →"}
            </span>
          </div>

          {/* Back — answer */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              background: "rgba(255,255,255,0.22)",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-2 px-6"
          >
            <p className="text-sm text-white text-center leading-relaxed">
              {card.back}
            </p>
            {card.note && (
              <>
                <div
                  style={{
                    width: "100%",
                    height: 1,
                    background: "rgba(255,255,255,0.35)",
                    margin: "2px 0",
                  }}
                />
                <p
                  className="text-xs text-white/70 text-center leading-relaxed"
                  style={{ whiteSpace: "pre-line" }}
                >
                  {card.note}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress / navigation */}
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs text-white/70">
          <span>
            Card {index + 1} of {CARDS.length}
          </span>
          {paused ? (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goTo((index - 1 + CARDS.length) % CARDS.length);
                }}
                className="text-white/60 hover:text-white transition-colors leading-none"
                style={{ fontSize: 16 }}
              >
                ‹
              </button>
              {CARDS.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(i);
                  }}
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: i === index ? 18 : 6,
                    height: 6,
                    background:
                      i === index
                        ? "rgba(255,255,255,0.9)"
                        : "rgba(255,255,255,0.4)",
                  }}
                />
              ))}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goTo((index + 1) % CARDS.length);
                }}
                className="text-white/60 hover:text-white transition-colors leading-none"
                style={{ fontSize: 16 }}
              >
                ›
              </button>
            </div>
          ) : (
            <span>{progress}%</span>
          )}
        </div>
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.25)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: "rgba(255,255,255,0.85)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
