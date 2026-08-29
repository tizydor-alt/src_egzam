CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  question_nr INTEGER NOT NULL,
  mastered INTEGER NOT NULL DEFAULT 0 CHECK (mastered IN (0, 1)),
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_answer TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, question_nr)
);

CREATE INDEX IF NOT EXISTS idx_progress_user_mastered
ON progress(user_id, mastered);
