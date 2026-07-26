# Use Postgres instead of libSQL/Turso

mastra-chat-kit ships on **libSQL/Turso** by default: storage, threads,
observability, and vector search all run on a single `LibSQLStore` +
`LibSQLVector`, from a local `file:` DB with no server and no Docker. That's the
zero-friction path.

If you'd rather run **Postgres + pgvector** (e.g. you already operate Supabase/
Neon/RDS, or want Postgres tooling), it's a small, self-contained swap. Nothing
else in the kit depends on the storage backend.

## 1. Install the Postgres packages

```bash
pnpm --filter @mastra-chat-kit/server add @mastra/pg
```

## 2. Point storage at Postgres — `src/mastra/index.ts`

Replace the libSQL store with a Postgres one:

```diff
-import { LibSQLStore } from '@mastra/libsql';
+import { PostgresStore } from '@mastra/pg';

-const storage = new LibSQLStore({
-  id: 'mastra-storage',
-  url: env.TURSO_DATABASE_URL,
-  ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
-});
+const storage = new PostgresStore({
+  id: 'mastra-storage',
+  connectionString: env.DATABASE_URL,
+});
```

`PostgresStore` serves every Mastra domain (default, editor, observability), so
the single `storage` binding on the `Mastra` instance is all you need — no
composite store required.

## 3. Point vectors at pgvector — `src/mastra/lib/memory.ts`

```diff
-import { LibSQLVector } from '@mastra/libsql';
+import { PgVector } from '@mastra/pg';

-    sharedVector = new LibSQLVector({
-      id: 'mastra-vector',
-      url: env.TURSO_DATABASE_URL,
-      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
-    });
+    sharedVector = new PgVector({
+      id: 'mastra-vector',
+      connectionString: env.DATABASE_URL,
+    });
```

Semantic recall (fastembed `bge-small`, 384-dim) is unchanged — only the vector
store swaps. pgvector needs the `vector` extension (Supabase enables it; for a
local Postgres use a `pgvector/pgvector` image).

## 4. Swap the env var — `src/lib/env.ts`

```diff
-    TURSO_DATABASE_URL: z.string().default('file:./mastra.db'),
-    TURSO_AUTH_TOKEN: z.string().optional(),
+    DATABASE_URL: z
+      .string()
+      .url()
+      .refine((v) => v.startsWith('postgres'), 'Must be a postgres:// connection string'),
```

Then set `DATABASE_URL` in `.env`, e.g.:

```bash
# Local (via `npx supabase start` — Postgres + pgvector on shifted ports):
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Hosted: use the Supabase/Neon session-pooler connection string.
```

## 5. Local Postgres for dev

Either use the Supabase CLI:

```bash
npx supabase start   # Postgres + pgvector in Docker
```

…or bring your own `pgvector/pgvector:pg16` container and point `DATABASE_URL`
at it.

## 6. Docker Compose deploy (optional)

The default `packages/server/docker-compose.yml` runs storage on libSQL, so it has
no Postgres service. If you've switched the code to Postgres and deploy via
Compose, add the service back (the init script that enables the `vector`
extension is still shipped at `packages/server/docker/postgres-init/`):

```yaml
services:
  mastra:
    environment:
      # replaces TURSO_DATABASE_URL for a Postgres build
      - DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro # enables `vector`
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
    # no published port → reachable only as `postgres` on the internal network

volumes:
  pgdata: {}
```

You can drop the `libsqldata` volume + its mount and the `TURSO_DATABASE_URL`
env from the `mastra` service, since a Postgres build no longer reads them. Set
`POSTGRES_PASSWORD` in `.env`.

That's the whole switch. `pnpm --filter @mastra-chat-kit/server typecheck` and
`test` should stay green.
