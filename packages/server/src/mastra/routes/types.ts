// The dependency contract for the AgentController route modules.
//
// WHY THIS EXISTS. The routes are the portable half of this server — the HTTP
// contract the web chat layer speaks. Everything else (which agents exist, which
// storage backs them, whether Dolt is wired up) is *this repo's* reference
// implementation and has no business being forced on a consumer.
//
// Measured before this seam existed: the three route modules transitively pulled
// in 2283 lines across 20 files — all six agents, the tools, memory, processors,
// Dolt and env — because they imported `lib/agent-controller` directly. Shipping
// that closure would have been "clone the repo" wearing a registry costume.
//
// So the routes now take what they need instead of importing it. `index.ts`
// supplies this repo's implementation; a consumer supplies their own, against
// their own AgentController, in their own Mastra project. One code path either
// way — the reference server is just the first caller.

import type { AgentController, Session } from '@mastra/core/agent-controller';

/** A file or directory in the workspace tree the Files panel renders. */
export type WorkspaceNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: WorkspaceNode[];
};

/** What `/browser/screencast` drives. Structural, so any viewer that satisfies
 *  it works — this deliberately does not name @mastra/browser-viewer. */
// Method shorthand (not property-with-arrow) on purpose: it makes parameter
// checking bivariant, so a concrete viewer whose signatures are narrower than
// this — @mastra/browser-viewer types `format` as 'jpeg' | 'png' — still satisfies
// the contract without a cast.
export type ScreencastBrowser = {
  isBrowserRunning(): boolean;
  launch(): Promise<unknown>;
  ensureReady(): Promise<unknown>;
  startScreencast(opts: {
    format: 'jpeg' | 'png';
    quality: number;
    maxWidth: number;
    maxHeight: number;
  }): Promise<{
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous frame/url/error/stop payloads
    on(event: string, cb: (arg: any) => void): unknown;
    stop(): Promise<unknown>;
  }>;
};

/** One hit from the message vector index, as `/threads/search` reads it. */
export type SearchHit = {
  metadata?: Record<string, unknown>;
  score?: number;
};

export type ChatServerDeps = {
  /** The live AgentController Session every route drives. */
  getSession: () => Promise<Session>;
  /** The controller behind that session — goals and observational memory. */
  getAgentController: () => Promise<AgentController>;

  /** Agent id used for `mastra.schedules.list` and the memory lookup in PATCH. */
  agentId: string;

  workspace: {
    /** Absolute root, echoed to the Files panel. */
    root: string;
    readTree: () => Promise<WorkspaceNode[]>;
    readFile: (relPath: string) => Promise<unknown | null>;
  };

  /** Generated-image byte store (`/images/:id`). */
  getImage: (id: string) => unknown | undefined;

  /** Live browser for `/browser/screencast`. */
  getBrowser: () => Promise<ScreencastBrowser>;

  /**
   * Semantic thread search. OPTIONAL — omit it and `/threads/search` answers
   * `{ threads: [] }` rather than 500ing, so a consumer without a vector index
   * still gets a working sidebar.
   */
  search?: {
    /** Embed the query. Local (fastembed) here; a consumer may use anything. */
    embed: (query: string) => Promise<number[]>;
    /** Query the message vector index, already scoped to the right resource. */
    query: (embedding: number[], topK: number) => Promise<SearchHit[]>;
  };

  /**
   * Model ids `/agent-controller/stream` will accept from the composer. An
   * unknown id falls back to the agent's own configured model rather than
   * erroring.
   */
  modelAllowlist: ReadonlySet<string>;
};
