CREATE TABLE IF NOT EXISTS scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  score        INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL  -- Unix timestamp ms
);

CREATE INDEX IF NOT EXISTS idx_scores_score      ON scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player_id  ON scores (player_id);
