// Generates the offline HSK index bundled into the Worker.
//
//   node scripts/build-hsk-index.mjs
//
// Why this exists: when the dictionary is unreachable — the server is down, or
// the public endpoint's 30 req/min ceiling is binding — the tutor still has to
// show a correct word card. This index is what makes that rung unfailable.
//
// Source is the MCP server's `hsk://level/N` resources: seven reads for the
// whole dataset, versus 574 paginated tool calls. It reuses the Worker's own
// client with no HSK binding, so it takes the public HTTPS path and there is
// one implementation of the protocol rather than two.
//
// Deliberately narrower than the live server: one meaning, no transcriptions
// beyond pinyin, no radical, no classifiers, no traditional form (the resources
// do not carry it). This is a fallback tier, not a second copy of the dataset —
// anything richer must come from the live server.

import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readResource, callTool } from "../src/integrations/hskMcp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/services/zh/data/hsk-core.json");

// No HSK binding — the client falls through to the public endpoint.
const env = {};

const LEVELS = [1, 2, 3, 4, 5, 6, 7];

// KNOWN GAP, measured 2026-07-30: ~3% of entries (336 of 10,969) carry a
// meaning that does not define the word — 也 → "surname Ye", 都 → "surname Du",
// 药 → "leaf of the iris". They cluster in the most common words, so they are
// over-represented in anything a beginner sees.
//
// It is not a gloss-picking problem, and picking a later meaning does not fix
// it: `hsk://level/N` returns ONE form per word and for these it returns the
// wrong reading outright — 也 comes back as "Yě", 都 as "Dū". The right meaning
// is not in the payload at all.
//
// Fixing it means re-fetching those entries through `hsk_lookup`, which does
// return every form, throttled under the server's 30 req/min ceiling — a
// ~10-minute one-off build step. Worth doing; deliberately not done here.
//
// It only degrades the offline fallback tier: resolve.js enriches from the live
// server whenever it answers, so a learner normally sees the correct meaning.
function firstMeaning(meanings) {
  const m = Array.isArray(meanings) ? meanings[0] : meanings;
  if (typeof m !== "string") return "";
  // Meanings carry parenthetical grammar notes that are noise on a fallback
  // card. Keep them only when stripping would leave nothing.
  const stripped = m.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return (stripped || m).slice(0, 80);
}

async function main() {
  const meta = await readResource(env, "hsk://meta").catch(() => null);
  const version = meta?.dataset_version || meta?.version || "unknown";
  console.log(`dataset_version: ${version}`);

  const levels = {};
  let total = 0;

  for (const level of LEVELS) {
    const data = await readResource(env, `hsk://level/${level}`);
    const words = Array.isArray(data?.words) ? data.words : [];

    // Order is preserved on purpose: the resources are sorted by frequency, so
    // array position IS the within-level frequency rank. That plus the level is
    // a good enough global ordering to pick the hardest words in a paragraph,
    // and it costs zero bytes to store.
    levels[level] = words
      .filter((w) => w?.simplified)
      .map((w) => [w.simplified, w.pinyin || "", firstMeaning(w.meanings)]);

    total += levels[level].length;
    console.log(`  level ${level}: ${String(levels[level].length).padStart(5)} words`);
  }

  // The resources expose HSK 3.0 levels only, so words carried solely by the
  // old 2.0 scheme have no level to be listed under and fall out of the export.
  // That is a known, bounded gap — not a partial download — so it is recorded
  // rather than tolerated silently. A sudden change in it means something moved.
  const claimed = meta?.headword_count ?? null;
  const coverage = claimed ? total / claimed : null;
  if (coverage !== null && coverage < 0.9) {
    throw new Error(
      `export looks partial: ${total} of ${claimed} headwords (${(coverage * 100).toFixed(1)}%). ` +
        `Expected ~95% — the shortfall should only be old-scheme-only words.`,
    );
  }

  const payload = {
    dataset_version: version,
    generated_from: "hsk://level/1..7",
    fields: ["simplified", "pinyin", "meaning"],
    note:
      "Fallback tier. Order within a level is frequency order. Covers HSK 3.0 " +
      "levels only — words carried solely by the old 2.0 scheme are absent.",
    total,
    headwords_upstream: claimed,
    coverage: coverage ? Number(coverage.toFixed(4)) : null,
    levels,
  };

  const json = JSON.stringify(payload);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);

  const raw = Buffer.byteLength(json);
  const gz = gzipSync(json).length;
  console.log("");
  console.log(`words:  ${total}`);
  console.log(`raw:    ${(raw / 1024).toFixed(0)} KB`);
  console.log(`gzip:   ${(gz / 1024).toFixed(0)} KB   ← what counts against the Worker limit`);
  console.log(`wrote:  ${OUT}`);
}

main().catch((err) => {
  console.error("failed:", err.message);
  process.exit(1);
});
