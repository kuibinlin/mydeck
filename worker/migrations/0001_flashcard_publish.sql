-- Draft/publish for flashcard decks.
--
-- Challenge decks already had a published state: a row in challenge_versions.
-- Flashcard decks had none, so every deck went public the moment it was
-- created — including empty ones. This adds the missing flag so both deck
-- types follow the same create → fill → publish flow.
--
-- No versions table for flashcards on purpose. Challenges snapshot their
-- questions because leaderboard scores must stay attached to the exact question
-- set they were earned against. Flashcards have no scores, so a boolean is the
-- whole requirement.

ALTER TABLE flashcard_decks ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0;

-- Backfill at > 0 rather than >= 3.
--
-- The new rule is "3 cards to publish", but applying it retroactively would
-- unpublish existing decks that hold one or two cards and are public today.
-- Anything already visible and non-empty stays visible; the threshold governs
-- new publishes only.
UPDATE flashcard_decks
SET is_published = 1
WHERE (
  SELECT COUNT(*) FROM flashcards
  WHERE flashcards.deck_id = flashcard_decks.id
    AND flashcards.is_deleted = 0
) > 0;

CREATE INDEX IF NOT EXISTS idx_flashcard_decks_published
  ON flashcard_decks(is_published);
