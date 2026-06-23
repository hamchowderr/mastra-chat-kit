-- Runs once on first Postgres init (pgvector/pgvector image ships the extension).
CREATE EXTENSION IF NOT EXISTS vector;
