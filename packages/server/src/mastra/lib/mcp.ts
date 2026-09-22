import { MCPServer } from '@mastra/mcp';
import { chatAgent } from '../agents/chat';
import { doltTools } from '../tools/dolt';

/**
 * The kit's MCP server: the chat agent (exposed as the `ask_chat` tool) plus the
 * Dolt versioned-data tools, so any MCP client can call them.
 */
export function createMcpServer(): MCPServer {
  return new MCPServer({
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
}
