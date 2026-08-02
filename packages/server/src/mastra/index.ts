// 1. Env validation FIRST — crashes process if misconfigured
import { env } from '../lib/env';

// 2. AIMock provider switch — must run before any AI SDK client constructs
import { configureAIMock } from './lib/aimock';

configureAIMock();

import { MastraJwtAuth } from '@mastra/auth';
// 3. Mastra imports — agents/tools constructed below now see the right base URLs
import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraEditor } from '@mastra/editor';
import { fastembed } from '@mastra/fastembed';
import { PinoLogger } from '@mastra/loggers';
import { MCPServer } from '@mastra/mcp';
import { MastraStorageExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { embed } from 'ai';
import { chatAgent } from './agents/chat';
import {
  CHAT_RESOURCE_ID,
  getChatAgentController,
  getChatBrowser,
  getChatSession,
  WORKSPACE_ROOT,
} from './lib/agent-controller';
import { doltConfigured, ensureDatabase } from './lib/dolt';
import { getImage } from './lib/image-store';
import { getSharedStore, getSharedVector, MESSAGE_VECTOR_INDEX } from './lib/memory';
import { readWorkspaceFile, readWorkspaceTree } from './lib/workspace-files';
// The AgentController route contract, split by surface — see routes/. The modules
// are FACTORIES over a dependency contract (routes/types.ts) rather than importers
// of this file's wiring: the routes are the portable half (the HTTP contract the
// web layer speaks), everything below is this repo's reference implementation.
// Handlers reach the Mastra instance through the Hono context (`c.get('mastra')`),
// never by importing it from here, which would be circular.
import { createControllerRoutes } from './routes/controller';
import { createThreadRoutes } from './routes/threads';
import type { ChatServerDeps } from './routes/types';
import { createWorkspaceRoutes } from './routes/workspace';
import { doltTools } from './tools/dolt';

// Bootstrap the versioned Dolt database on first boot (no-op if Dolt isn't configured).
if (doltConfigured) {
  await ensureDatabase();
}

const mcpServer = new MCPServer({
  // `id` forms the mount path — /api/mcp/<id>/mcp — so it is user-visible.
  id: 'chat-kit',
  name: 'mastra-chat-kit',
  version: '0.1.0',
  description: 'MCP server exposing mastra-chat-kit agents + Dolt tools',
  // Dolt versioned-data tools exposed over MCP. To let an agent call them
  // directly, spread `...doltTools` into the agent's own `tools`.
  tools: { ...doltTools },
  agents: { chat: chatAgent },
});

// libSQL is the primary store (default/editor/memory domains + vectors). Local dev
// uses a file: DB — no server, no Docker; prod points TURSO_DATABASE_URL at a
// libsql:// Turso URL with TURSO_AUTH_TOKEN. libSQL has native vector search (no
// pgvector); only the observability OLAP domain uses DuckDB (see the composite
// store below). To switch the whole kit to Postgres instead, see docs/postgres.md.
// The ONE shared libSQL store — same instance the agents' Memory and the controller
// AgentController use, so threads/messages never split across DB files.
// libSQL serves the default/editor/memory domains + vectors; DuckDB serves ONLY
// the observability (OLAP) domain that Studio's Metrics/Logs query — libSQL can't
// back those views on core 1.52, so they'd read "not available". Memory + the
// controller use the same LibSQLStore (getSharedStore) directly, and the composite's
// `default` IS that instance, so threads/messages stay on one libSQL DB.
const storage = new MastraCompositeStore({
  id: 'composite-storage',
  default: getSharedStore(),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
  },
});

// JWT auth: when MASTRA_JWT_SECRET is set, gate all /api/* routes AND Studio
// behind a Bearer JWT signed with the shared secret. `/health` and `/api/auth/*`
// stay public (so healthchecks and the Studio login screen still work). Leave
// the secret unset for open local dev. Shared-secret only — no external provider.
// NB: name this `serverConfig`, not `server` — `mastra dev`'s generated entry
// declares its own top-level `server`, which collides in the bundler ("symbol
// 'server' has already been declared"). `mastra build` doesn't hit it.
// This repo's implementation of the route contract. A consumer installing the
// routes into their own Mastra project supplies their own object of this shape —
// their controller, their workspace, their vector index — and gets the same
// endpoints. See routes/types.ts for what each field is for.
const chatServerDeps: ChatServerDeps = {
  getSession: getChatSession,
  getAgentController: getChatAgentController,
  agentId: 'chat',
  workspace: {
    root: WORKSPACE_ROOT,
    readTree: readWorkspaceTree,
    readFile: readWorkspaceFile,
  },
  getImage,
  getBrowser: getChatBrowser,
  // fastembed is a LOCAL ONNX model — querying the sidebar costs no API spend.
  search: {
    embed: async (query) => (await embed({ model: fastembed, value: query })).embedding,
    query: (embedding, topK) =>
      getSharedVector().query({
        indexName: MESSAGE_VECTOR_INDEX,
        queryVector: embedding,
        topK,
        filter: { resource_id: CHAT_RESOURCE_ID },
      }),
  },
  // Models the composer's picker may request. Keep in sync with web `MODELS` in
  // components/chat/composer.tsx. An id not listed here falls back to the agent's
  // own `model: env.CHAT_MODEL` rather than erroring.
  modelAllowlist: new Set([
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-8',
    'anthropic/claude-haiku-4-5',
    'openai/gpt-4.1-mini',
    'openai/gpt-4o-mini',
    'openai/gpt-4.1-nano',
  ]),
};

const serverConfig = {
  apiRoutes: [
    ...createThreadRoutes(chatServerDeps),
    ...createControllerRoutes(chatServerDeps),
    ...createWorkspaceRoutes(chatServerDeps),
  ],
  ...(env.MASTRA_JWT_SECRET ? { auth: new MastraJwtAuth({ secret: env.MASTRA_JWT_SECRET }) } : {}),
};

export const mastra = new Mastra({
  server: serverConfig,
  agents: { chat: chatAgent },
  mcpServers: { baseMcp: mcpServer },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: env.LOG_LEVEL,
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  editor: new MastraEditor(),
});
