// Pulling structured data out of model text.
//
// Models wrap JSON in markdown fences, prepend "Here are your flashcards:",
// or emit trailing commas. These strategies run in order until one works.
//
// `expect` controls what counts as a result:
//   "array" — only a top-level array (an object wrapper is unwrapped to the
//             first array value inside it). This is what card/question
//             generation wants.
//   "any"   — an object is returned as-is. Needed for outputs that are
//             genuinely object-shaped, e.g. a grading result carrying both
//             per-item scores and a total.

export function extractJSON(raw, { expect = "array" } = {}) {
  if (!raw || typeof raw !== "string") {
    console.log("[extractJSON] raw is not a string:", typeof raw, raw);
    return null;
  }

  const text = raw.trim();

  // 1. Straight parse.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (expect === "any") return parsed;
      // Some models wrap the array in { "cards": [...] } or { "questions": [...] }.
      const arr = Object.values(parsed).find((v) => Array.isArray(v));
      if (arr) return arr;
    }
  } catch {
    /* not valid JSON, try next strategy */
  }

  // 2. Inside a markdown code block.
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (expect === "any" && parsed && typeof parsed === "object")
        return parsed;
    } catch {
      /* not valid JSON in code block */
    }
  }

  // 3. Largest bracketed span in the raw text.
  const spanMatch =
    expect === "any"
      ? text.match(/[[{][\s\S]*[\]}]/)
      : text.match(/\[[\s\S]*\]/);
  if (spanMatch) {
    try {
      return JSON.parse(spanMatch[0]);
    } catch {
      /* not valid JSON */
    }
    // Common repairs: trailing commas before a closing brace, single quotes.
    try {
      const fixed = spanMatch[0]
        .replace(/,\s*(\]|\})/g, "$1")
        .replace(/'/g, '"');
      return JSON.parse(fixed);
    } catch {
      /* still not valid */
    }
  }

  console.log(
    "[extractJSON] all strategies failed for:",
    text.substring(0, 500),
  );
  return null;
}
