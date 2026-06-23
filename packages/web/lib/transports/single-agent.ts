import { DefaultChatTransport } from 'ai';

/**
 * Single Agent transport. The web app is pure frontend — it talks to the
 * standalone Mastra server over HTTP. Points `useChat` at a same-origin Next
 * proxy route (`/api/chat/:agentId`) that forwards to the server's `chatRoute`
 * (`/chat/:agentId`), keeping Mastra out of the Next webpack bundle and avoiding
 * CORS. Swapping this for the Agent Harness transport (command POST + SSE) is the
 * only change needed to drive the same UI with the Harness engine.
 */
export function singleAgentTransport(agentId = 'chat') {
  return new DefaultChatTransport({ api: `/api/chat/${agentId}` });
}
