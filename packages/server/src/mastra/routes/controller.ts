// ──────────────────────────────────────────────────────────────────────────
// The Agent Controller run surface: the SSE stream, the two human-in-the-loop
// resolvers (tool approval + tool suspension), and the read-only views the web
// panels hydrate from (goal, observational memory, schedules).
//
// NOTE: modes (Chat / Plan) stay configured on the controller (see
// lib/agent-controller.ts) and are exercised by the integration test, but there's
// no HTTP switch route — planning is AGENT-DRIVEN (the agent calls the built-in
// submit_plan when a task warrants a plan), so the UI has no manual mode switcher
// to back.
// ──────────────────────────────────────────────────────────────────────────

import { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import type { ChatServerDeps } from './types';

export const createControllerRoutes = (deps: ChatServerDeps) => [
  // Agent Controller endpoint: POST /agent-controller/stream → SSE of AgentControllerEvents.
  // Body: { text: string, threadId?: string }. The AgentController wraps the same
  // chatAgent but emits the richer orchestration surface (sessions, modes,
  // approvals, subagents, tasks) the AI SDK UIMessage stream can't carry.
  // The web `agent-controller` transport maps these events onto the same elements.
  registerApiRoute('/agent-controller/stream', {
    method: 'POST',
    handler: async (c) => {
      const { text, threadId, model, webSearch, files } = await c.req.json<{
        text?: string;
        threadId?: string;
        model?: string;
        webSearch?: boolean;
        // The composer's attachments (FileUIPart): `url` is a data URL after the
        // client's submit-time blob→dataURL conversion, so it's safe to forward.
        files?: Array<{ url: string; mediaType: string; filename?: string }>;
      }>();
      if (!text?.trim()) {
        return c.json({ error: 'text is required' }, 400);
      }
      // Route the composer's "Search" toggle through the request context (not the
      // user message) so the agent's dynamic instructions flip into browse-the-web
      // mode — driving the workspace browser the Browser panel screencasts.
      let requestContext: RequestContext | undefined;
      if (webSearch === true) {
        requestContext = new RequestContext();
        requestContext.set('webSearch', true);
      }
      // Map the composer's attachments onto sendMessage's file shape ({ data, ... }).
      // `createMessageInput` accepts a data URL as `data` for both text and binary parts.
      const messageFiles = files?.length
        ? files.map((f) => ({
            data: f.url,
            mediaType: f.mediaType,
            ...(f.filename ? { filename: f.filename } : {}),
          }))
        : undefined;

      const session = await deps.getSession();
      // Resume the given thread, or start a fresh thread when none is sent. No
      // placeholder title — the sidebar derives the display title from the first
      // user message (chat-app convention) until AI titling lands (see 698.11).
      if (threadId) {
        await session.thread.switch({ threadId });
      } else {
        await session.thread.create();
      }
      const activeThreadId = session.thread.requireId();

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // Guard every enqueue: once the client disconnects the stream controller
          // closes, but the session keeps emitting events for a few ticks while the
          // run finalizes — enqueueing then throws "Controller is already closed".
          let closed = false;
          // biome-ignore lint/suspicious/noExplicitAny: SSE payloads are heterogeneous AgentControllerEvents
          const send = (obj: any) => {
            if (closed) {
              return;
            }
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              closed = true; // client went away mid-run
            }
          };

          const unsubscribe = session.subscribe((event) => send(event));
          // On client disconnect: stop forwarding, drop the subscription, abort the run.
          c.req.raw.signal?.addEventListener('abort', () => {
            closed = true;
            unsubscribe();
            session.abort();
          });

          // Hand the client the active thread id so it can continue the conversation.
          send({ type: '__thread__', threadId: activeThreadId });
          try {
            // Honor the composer's model pick (validated against MODEL_ALLOWLIST).
            // Switching here — inside the subscribed
            // stream — lets the resulting `model_changed` event flow to the client too.
            if (model && deps.modelAllowlist.has(model)) {
              await session.model.switch({ modelId: model });
            }
            await session.sendMessage({
              content: text,
              ...(messageFiles ? { files: messageFiles } : {}),
              ...(requestContext ? { requestContext } : {}),
            });
          } catch (err) {
            send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
          } finally {
            unsubscribe();
            send({ type: '__done__' });
            if (!closed) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      });
    },
  }),

  // Agent Controller HITL: POST /agent-controller/approve resolves a parked tool-approval
  // gate. The matching /agent-controller/stream call is suspended at the gate; responding
  // here resumes it and the continuation events flow on that still-open SSE.
  registerApiRoute('/agent-controller/approve', {
    method: 'POST',
    handler: async (c) => {
      const { decision } = await c.req.json<{
        decision?: 'approve' | 'decline' | 'always_allow_category';
      }>();
      if (
        decision !== 'approve' &&
        decision !== 'decline' &&
        decision !== 'always_allow_category'
      ) {
        return c.json({ error: 'decision must be approve | decline | always_allow_category' }, 400);
      }
      const session = await deps.getSession();
      session.respondToToolApproval({ decision });
      return c.json({ ok: true });
    },
  }),

  // Agent Controller HITL: POST /agent-controller/answer resolves a parked tool SUSPENSION —
  // the agent-driven `ask_user` flow. When a request is ambiguous the agent calls
  // the built-in `ask_user`, which suspends the run (emitting `tool_suspended` with
  // the question); the matching /agent-controller/stream call is parked awaiting the answer.
  // Posting the answer here resumes the SAME suspended tool and the continuation
  // events flow on the still-open SSE. `answer` is a string (free-text / single
  // choice) or string[] (multi-select labels); `toolCallId` selects which prompt to
  // resolve when several are pending (optional when only one is).
  registerApiRoute('/agent-controller/answer', {
    method: 'POST',
    handler: async (c) => {
      const { answer, toolCallId } = await c.req.json<{
        answer?: string | string[];
        toolCallId?: string;
      }>();
      if (typeof answer !== 'string' && !Array.isArray(answer)) {
        return c.json({ error: 'answer must be a string or string[]' }, 400);
      }
      const session = await deps.getSession();
      await session.respondToToolSuspension({
        resumeData: answer,
        ...(toolCallId ? { toolCallId } : {}),
      });
      return c.json({ ok: true });
    },
  }),

  // Agent Controller goals: the agent's native objective mechanism (flagship demo). Goals
  // are AGENT-DRIVEN — the chat agent calls its own `setGoal` tool when it recognizes a
  // standing objective (see agents/chat.ts), which iterates toward it: after each turn a
  // judge scores the objective and the run loops (up to maxRuns) until it passes, emitting
  // `goal_evaluation` events the web folds into a goal card. These read/clear routes back
  // the card (hydrate on reload + dismiss); they drive the SAME session as /agent-controller/stream
  // via `controller.getCurrentAgent` (the mode-backing agent with the controller's storage).

  // GET the current objective for the session's active thread ({ objective: record|null }).
  registerApiRoute('/agent-controller/goal', {
    method: 'GET',
    handler: async (c) => {
      const controller = await deps.getAgentController();
      const session = await deps.getSession();
      const threadId = session.thread.getId();
      if (!threadId) {
        return c.json({ objective: null });
      }
      const agent = controller.getCurrentAgent(session);
      const objective = await agent.getObjective({ threadId });
      return c.json({ objective: objective ?? null });
    },
  }),

  // Clear the objective for the active thread (the agent stops goal-driven looping).
  registerApiRoute('/agent-controller/goal', {
    method: 'DELETE',
    handler: async (c) => {
      const controller = await deps.getAgentController();
      const session = await deps.getSession();
      const threadId = session.thread.getId();
      if (threadId) {
        await controller.getCurrentAgent(session).clearObjective({ threadId });
      }
      return c.json({ ok: true });
    },
  }),

  // GET the current Observational-Memory record — the facts the Observer has distilled
  // across this resource's conversations. Lets the Memory panel show learned facts ON
  // LOAD (before the next run's `om_status` fills the live token windows), so a returning
  // user isn't met with an empty panel. Strips the `<thread id="…">` attribution wrappers
  // (present in resource scope) to plain text for display.
  registerApiRoute('/agent-controller/om', {
    method: 'GET',
    handler: async (c) => {
      const controller = await deps.getAgentController();
      const session = await deps.getSession();
      const record = await controller.getObservationalMemoryRecord(session);
      const observations =
        record?.activeObservations?.replace(/<\/?thread[^>]*>/g, '').trim() || null;
      return c.json({
        observations,
        generationCount: record?.generationCount ?? 0,
        lastObservedAt: record?.lastObservedAt ?? null,
      });
    },
  }),

  // List the recurring schedules the controller agent has set up (the Schedules
  // panel). Reads the native `mastra.schedules` service directly — the same
  // service the agent's start_schedule / stop_schedule tools write to — and
  // returns flat agent-schedule views. Read-only: creating/pausing is
  // AGENT-DRIVEN (the user asks the agent), so there's no mutate route here.
  // The Mastra instance comes off the Hono context (`CustomRouteVariables`) rather
  // than an import — importing it from index.ts would be circular.
  registerApiRoute('/agent-controller/schedules', {
    method: 'GET',
    handler: async (c) => {
      const rows = await c.get('mastra').schedules.list({ agentId: deps.agentId });
      const schedules = rows
        // biome-ignore lint/suspicious/noExplicitAny: AnySchedule union — agent schedules carry agentId
        .filter((s: any) => s?.agentId)
        // biome-ignore lint/suspicious/noExplicitAny: flat AgentSchedule view
        .map((s: any) => ({
          id: String(s.id),
          cron: String(s.cron ?? ''),
          prompt: String(s.prompt ?? ''),
          status: s.status === 'paused' ? 'paused' : 'active',
          nextFireAt: typeof s.nextFireAt === 'number' ? s.nextFireAt : 0,
          lastFireAt: typeof s.lastFireAt === 'number' ? s.lastFireAt : null,
          ...(s.name ? { name: String(s.name) } : {}),
        }))
        .sort((a, b) => a.nextFireAt - b.nextFireAt);
      return c.json({ schedules });
    },
  }),
];
