-- Enable pgvector on local Postgres 18
-- Run: psql -U postgres -d <db_name> -f this_file.sql
-- OR:  npx prisma migrate deploy  (marks it applied in _prisma_migrations)
CREATE EXTENSION IF NOT EXISTS vector;

-- Partial expression index for fast cosine similarity on CorporateMemory.
-- Skips NULL rows (WHERE clause), avoids cast errors on empty cells.
-- lists = 10 is conservative for < 10 k rows; increase with data growth.
CREATE INDEX IF NOT EXISTS "CorporateMemory_vector_cosine_idx"
  ON "CorporateMemory"
  USING ivfflat (("vectorEmbedding"::text::vector(1536)) vector_cosine_ops)
  WITH (lists = 10)
  WHERE "vectorEmbedding" IS NOT NULL;
