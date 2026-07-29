// Validators for model output.
//
// Passed to generateStructured, which retries until one of these returns true
// or the attempt budget runs out. Keep them strict — a lenient validator lets
// malformed cards reach the database.

const CHOICE_COUNT = 4;

export function validateFlashcards(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (c) =>
      typeof c.front === "string" &&
      c.front.length > 0 &&
      typeof c.meaning === "string" &&
      c.meaning.length > 0 &&
      (c.note === undefined || c.note === null || typeof c.note === "string"),
  );
}

export function validateChallengeCards(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (c) =>
      typeof c.question === "string" &&
      c.question.length > 0 &&
      Array.isArray(c.choices) &&
      c.choices.length === CHOICE_COUNT &&
      c.choices.every((ch) => typeof ch === "string" && ch.length > 0) &&
      typeof c.answer === "number" &&
      c.answer >= 0 &&
      c.answer <= CHOICE_COUNT - 1,
  );
}
