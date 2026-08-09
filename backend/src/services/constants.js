// Limits that must stay identical across deck types.
//
// Flashcards and challenges deliberately share one publish threshold. The point
// of the draft/publish flow is that a user learns it once and it behaves the
// same everywhere; letting the two numbers drift would recreate exactly the
// confusion the flow exists to remove. Per-deck-type limits (title length, card
// caps) stay local to their own service.

export const MIN_ITEMS_TO_PUBLISH = 3;
