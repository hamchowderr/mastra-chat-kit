# Base Polish 01 — Install Required Packages + Configure Editor Storage

Install the two packages this polish needs, then add the editor storage domain.

## Step 1: Install packages

Both packages are required. The base template currently has neither.

```bash
cd C:\Users\HamCh\code\template-mastra-base
npm install @mastra/editor @mastra/mcp
```

Verify:
```bash
npm list @mastra/editor @mastra/mcp
```

**Pass**: both packages listed at version >= 1.24.0.

## Step 2: Configure editor storage domain

Open `src/mastra/index.ts`. Find the existing `MastraCompositeStore` block:

```typescript
storage: new MastraCompositeStore({
  id: 'composite-storage',
  default: new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL }),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
  },
}),
```

The `editor` storage domain belongs alongside `observability`:

```typescript
storage: new MastraCompositeStore({
  id: 'composite-storage',
  default: new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL }),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
    editor: new PostgresStore({ id: 'mastra-editor-storage', connectionString: env.SUPABASE_DB_URL }),
  },
}),
```

The editor domain shares the Postgres connection but uses a separate `id` so Mastra can route editor data to its own table set. Per Mastra docs:

> "Within MastraCompositeStore, the editor key is its own storage domain, so you can point it at a different database than the rest of your Mastra storage."

For client deliverables on a single VPS with one Supabase Postgres, sharing the connection is the right call. A client who later needs isolation swaps the connection string in this single line.

**Pass**: typecheck passes after the change.

```bash
npm run typecheck
```

## What to capture in PROGRESS.md

```
## Base Polish 01: Install Packages + Editor Storage
- Status: complete
- Installed: @mastra/editor v<version>, @mastra/mcp v<version>
- File changed: src/mastra/index.ts (added editor domain to MastraCompositeStore)
- Verification: typecheck passes
```

Move on to Polish 02.
