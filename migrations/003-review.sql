CREATE TABLE IF NOT EXISTS import_reviews (
  key text PRIMARY KEY, source_ids text[] NOT NULL, note text NOT NULL, seen_at bigint NOT NULL,
  resolved_at bigint, resolution text
);
