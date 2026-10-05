/**
 * Refresh fixtures/firecrawl-mcp-tools.json: the tool list a real `firecrawl-mcp` server
 * advertises, which the tests serve from AIMock's MCP mock in place of Firecrawl.
 *
 *   pnpm --filter @mastra-chat-kit/server exec tsx scripts/capture-firecrawl-tools.ts [version]
 *
 * It starts the published server over stdio and asks for its tools. Listing tools makes
 * no Firecrawl API call, and the server gets a dummy key and an unreachable API URL, so
 * no request can reach Firecrawl or spend credits.
 *
 * The kit offers only lib/firecrawl.ts's FIRECRAWL_TOOLS, so those keep their full
 * definitions. Every other tool is cut to its name and an empty object schema (the
 * least a tools/list entry must have), which is enough to prove the kit filters them out.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPClient } from '@mastra/mcp';

// src/lib/env.ts validates at import; this script needs none of the app's settings.
process.env.APP_SECRET ??= 'capture-script-placeholder-secret-0000000000';
process.env.ANTHROPIC_API_KEY ??= 'unused';
const { FIRECRAWL_TOOLS } = await import('../src/mastra/lib/firecrawl');

const version = process.argv[2] ?? '3.27.3';
const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/firecrawl-mcp-tools.json',
);

const mcp = new MCPClient({
  id: 'firecrawl-capture',
  timeout: 300_000, // the first npx run downloads the package
  servers: {
    firecrawl: {
      command: 'npx',
      args: ['-y', `firecrawl-mcp@${version}`],
      env: {
        FIRECRAWL_API_KEY: 'fc-capture-not-a-real-key',
        FIRECRAWL_API_URL: 'http://127.0.0.1:9',
      },
    },
  },
});

const { definitions, errors } = await mcp.listToolDefinitionsWithErrors();
await mcp.disconnect();
if (errors.firecrawl) throw new Error(errors.firecrawl);

const offered = new Set<string>(FIRECRAWL_TOOLS);
const tools = Object.values(definitions.firecrawl ?? {}).map((def) =>
  offered.has(def.name)
    ? {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        annotations: def.annotations,
      }
    : { name: def.name, inputSchema: { type: 'object' } },
);

writeFileSync(
  out,
  `${JSON.stringify({ _source: `firecrawl-mcp@${version} tools/list (stdio)`, tools }, null, 2)}\n`,
);
console.log(`wrote ${tools.length} tools to ${out}`);
