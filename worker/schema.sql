-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  github_id TEXT UNIQUE,
  github_username TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Flash Card Decks
--
-- is_published mirrors what a row in challenge_versions means for a challenge
-- deck: until it is set, only the owner sees the deck. Flashcards need no
-- versions table because they carry no scores — see migrations/0001.
CREATE TABLE IF NOT EXISTS flashcard_decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flashcard_decks_published
  ON flashcard_decks(is_published);

-- Flash Cards
CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER REFERENCES flashcard_decks(id),
  front TEXT NOT NULL,
  meaning TEXT NOT NULL,
  note TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Challenge Decks
CREATE TABLE IF NOT EXISTS challenge_decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  article TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Challenge Cards (MCQ)
CREATE TABLE IF NOT EXISTS challenge_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER REFERENCES challenge_decks(id),
  question TEXT NOT NULL,
  choices TEXT NOT NULL,
  answer INTEGER NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Challenge Versions (for fair leaderboards)
CREATE TABLE IF NOT EXISTS challenge_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER REFERENCES challenge_decks(id),
  version INTEGER NOT NULL,
  card_ids TEXT NOT NULL,
  card_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Scores
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  challenge_version_id INTEGER REFERENCES challenge_versions(id),
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, challenge_version_id)
);

-- Deck Links (flashcard <-> challenge)
CREATE TABLE IF NOT EXISTS deck_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flashcard_deck_id INTEGER REFERENCES flashcard_decks(id),
  challenge_deck_id INTEGER REFERENCES challenge_decks(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(flashcard_deck_id, challenge_deck_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON flashcards(deck_id);
CREATE INDEX IF NOT EXISTS idx_challenge_cards_deck ON challenge_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_challenge_versions_deck ON challenge_versions(deck_id);
CREATE INDEX IF NOT EXISTS idx_scores_version ON scores(challenge_version_id);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_deck_links_fc ON deck_links(flashcard_deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_links_ch ON deck_links(challenge_deck_id);

-- AI Usage Log (for rate limiting)
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage_log(user_id, created_at);
