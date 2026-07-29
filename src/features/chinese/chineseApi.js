import { api } from "@/lib/apiClient";

// One turn. The floor is already on screen by the time this is called, so a
// failure here degrades the answer rather than replacing it — the caller keeps
// what it painted and shows an honest line underneath.
//
// `level` is the learner's HSK setting. It rides along on every turn because
// "give me some words" and "make me a game" have no other way to know what
// level means, and the server clamps it before anything uses it.
export const sendTurn = (message, level, signal) =>
  api("/api/zh/turn", {
    method: "POST",
    body: JSON.stringify({ message, level }),
    signal,
  });

// An activity finishing. The activity itself goes back with the numbers so the
// server can build its summary against a word list it produced, rather than
// trusting anything this request says about what was missed.
export const sendActivityResult = (activity, result, level, signal) =>
  api("/api/zh/turn", {
    method: "POST",
    body: JSON.stringify({ activityResult: { ...result, activity }, level }),
    signal,
  });
