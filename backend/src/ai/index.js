// Public surface of the AI module.
//
// Layers, lowest first:
//   providers/          one file per vendor, each normalizing to a common shape
//   callModel.js        a single model turn (text + toolCalls + stopReason)
//   generateStructured  ask/extract/validate/retry, built on callModel
//
// Importers should take what they need from here rather than reaching into
// submodules, so internals can move without a rename sweep.

export { callModel, activeProvider } from "./callModel.js";
export { generateStructured } from "./generateStructured.js";
export { extractJSON } from "./extract.js";
export { validateFlashcards, validateChallengeCards } from "./schemas.js";
export { shuffleChoices } from "./postprocess.js";
export { checkRateLimit, logUsage } from "./usage.js";

export * as prompts from "./prompts/index.js";
