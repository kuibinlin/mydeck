// What the client may say about earlier turns.
//
// The transcript lives in the browser — ChinesePage's `turns` is the only copy
// — so continuing a conversation means the client posting part of it back. That
// puts every field here in the same standing as `activityResult`, and it is
// bounded the same way: by shape, not by trust.
//
// The `message` field has always been 4,000 characters of free text going into
// a prompt that has tools attached, so free text is not the new capability.
// The new one is the ability to label text as something the *tutor* said, which
// is materially more persuasive than another user line. So this payload carries
// no roles at all. It is a list of {q, a} pairs, and roles are assigned below by
// position — which makes a `system` message, a `role:"tool"` message, and an
// assistant turn carrying `tool_calls` unrepresentable rather than filtered out.
//
// Words travel separately and as characters only. They are re-resolved against
// the dictionary before anything is done with them, so the client says which
// words came up, never what they mean.

const MAX_PAIRS = 6;
const MAX_FIELD_CHARS = 600;
const MAX_TOTAL_CHARS = 3000;
const MAX_WORDS = 12;

// The same shape rule summariseResult applies to a miss: Han, and short enough
// to be a word. A string like this cannot carry an instruction.
const WORD = /^\p{Script=Han}{1,8}$/u;

const field = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_FIELD_CHARS) : "");

/**
 * @param {unknown} raw  the client's `context`, in whatever state it arrived
 * @returns {{
 *   history: {role: "user"|"assistant", content: string}[],
 *   words: string[],
 * }}
 */
export function boundContext(raw) {
  const turns = Array.isArray(raw?.turns) ? raw.turns : [];

  // Budgeted newest-first so the oldest pairs are the ones dropped, then put
  // back in order. A pair missing either half is skipped entirely: an
  // unanswered question replayed as context invites the model to answer it a
  // second time, and a reply with nothing to reply to is noise.
  const history = [];
  let spent = 0;
  for (const turn of turns.slice(-MAX_PAIRS).reverse()) {
    const q = field(turn?.q);
    const a = field(turn?.a);
    if (!q || !a) continue;
    if (spent + q.length + a.length > MAX_TOTAL_CHARS) break;
    spent += q.length + a.length;
    history.unshift({ role: "user", content: q }, { role: "assistant", content: a });
  }

  const words = [];
  for (const candidate of Array.isArray(raw?.words) ? raw.words : []) {
    const word = typeof candidate === "string" ? candidate.trim() : "";
    if (WORD.test(word) && !words.includes(word)) words.push(word);
  }

  return { history, words: words.slice(-MAX_WORDS) };
}
