// Fixes applied to model output before it is stored.

// Shuffle each question's choices and move the answer index to follow.
//
// LLMs put the correct answer first far more often than chance, whatever the
// prompt's examples show. Shuffling once, server-side, before storage fixes
// the bias for every caller without any frontend or schema change.
//
//   order = [0,1,2,3]  →  shuffled  →  e.g. [2,0,3,1]
//   choices = order.map(i => original[i])     picks originals in the new order
//   answer  = order.indexOf(original answer)  finds where the correct one went
export function shuffleChoices(questions) {
  return questions.map((q) => {
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return {
      ...q,
      choices: order.map((i) => q.choices[i]),
      answer: order.indexOf(q.answer),
    };
  });
}
