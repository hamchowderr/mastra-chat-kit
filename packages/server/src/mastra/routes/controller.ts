// ──────────────────────────────────────────────────────────────────────────
// The Agent Controller run surface: the SSE stream, the two human-in-the-loop
// resolvers (tool approval + tool suspension), and the read-only views the web
// panels hydrate from (goal, observational memory, schedules).
//
// Modes (Chat / Plan) are configured on the controller (lib/agent-controller.ts).
// There's no separate switch route: a turn names its mode in the /stream body (the
// composer's Plan toggle), and approving a plan switches Plan → Chat by itself
// (the mode's `transitionsTo`). The agent can still plan unprompted from Chat mode by
// calling the built-in submit_plan.
// ──────────────────────────────────────────────────────────────────────────

import { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { sessionEventStream } from './session-sse';
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
      const { text, threadId, model, mode, webSearch, files } = await c.req.json<{
        text?: string;
        threadId?: string;
        model?: string;
        // The composer's Plan toggle: 'plan' | 'chat'. Unknown ids are ignored.
        mode?: string;
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
      const agentController = await deps.getAgentController();

      return sessionEventStream({
        session,
        signal: c.req.raw.signal,
        // tool_approval_required carries only the tool name. Add its category so the
        // UI can offer "Always allow <category> tools"; null means always-allow
        // would approve just this one call, so the UI hides that option.
        decorate: (event) =>
          event.type === 'tool_approval_required'
            ? { ...event, category: agentController.getToolCategory({ toolName: event.toolName }) }
            : event,
        // Hand the client the active thread id so it can continue the conversation.
        prelude: [{ type: '__thread__', threadId: activeThreadId }],
        run: async () => {
          // Honor the composer's model pick (validated against MODEL_ALLOWLIST).
          // Switching here — inside the subscribed
          // stream — lets the resulting `model_changed` event flow to the client too.
          if (model && deps.modelAllowlist.has(model)) {
            await session.model.switch({ modelId: model });
          }
          // Same for the mode: switching inside the stream sends `mode_changed` too.
          if (
            mode &&
            mode !== session.mode.get() &&
            agentController.listModes().some((m) => m.id === mode)
          ) {
            await session.mode.switch({ modeId: mode });
          }
          await session.sendMessage({
            content: text,
            ...(messageFiles ? { files: messageFiles } : {}),
            ...(requestContext ? { requestContext } : {}),
          });
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
  // the agent-driven `ask_user` flow, or a submitted plan (`plan`: approve / reject it). When a request is ambiguous the agent calls
  // the built-in `ask_user`, which suspends the tool and ENDS the run
  // (`agent_end` reason 'suspended'), so the /agent-controller/stream SSE has closed.
  // Posting the answer resumes the SAME suspended tool, and this response streams
  // the resumed run's events as SSE, the same shape /stream sends (mastra-chat-kit-ymk).
  // `answer` is a string (free-text / single choice) or string[] (multi-select
  // labels); `toolCallId` selects which prompt to resolve when several are pending.
  registerApiRoute('/agent-controller/answer', {
    method: 'POST',
    handler: async (c) => {
      const { answer, plan, toolCallId } = await c.req.json<{
        answer?: string | string[];
        // A decision on a `submit_plan` suspension. Core routes it through plan approval:
        // 'approved' switches to the mode's `transitionsTo` and resumes the agent on the
        // plan; 'rejected' resumes it with the (optional) feedback to revise by.
        plan?: { action?: string; feedback?: string };
        toolCallId?: string;
      }>();
      let resumeData: string | string[] | { action: 'approved' | 'rejected'; feedback?: string };
      if (plan !== undefined) {
        if (plan?.action !== 'approved' && plan?.action !== 'rejected') {
          return c.json({ error: 'plan.action must be approved | rejected' }, 400);
        }
        resumeData = {
          action: plan.action,
          ...(typeof plan.feedback === 'string' && plan.feedback
            ? { feedback: plan.feedback }
            : {}),
        };
      } else if (typeof answer === 'string' || Array.isArray(answer)) {
        resumeData = answer;
      } else {
        return c.json({ error: 'answer must be a string or string[], or plan an object' }, 400);
      }
      const session = await deps.getSession();
      return sessionEventStream({
        session,
        signal: c.req.raw.signal,
        run: () =>
          session.respondToToolSuspension({
            resumeData,
            ...(toolCallId ? { toolCallId } : {}),
          }),
      });
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
