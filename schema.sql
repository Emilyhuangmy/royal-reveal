CREATE TABLE IF NOT EXISTS scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  avatar       TEXT,
  country      TEXT,
  score        INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL  -- Unix timestamp ms
);

-- If upgrading existing DB: run:
-- ALTER TABLE scores ADD COLUMN avatar TEXT;
-- ALTER TABLE scores ADD COLUMN country TEXT;

CREATE INDEX IF NOT EXISTS idx_scores_score      ON scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player_id  ON scores (player_id);

-- Latest profile per player (name, avatar, country). Updated on profile save and on score submit.
CREATE TABLE IF NOT EXISTS profiles (
  player_id    TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar       TEXT,
  country      TEXT,
  updated_at   INTEGER NOT NULL
);
