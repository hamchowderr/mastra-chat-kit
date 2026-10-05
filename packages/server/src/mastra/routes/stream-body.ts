// What POST /agent-controller/stream accepts, checked before anything reaches the
// session. The body comes from the browser, and the server may face the internet.
//
// Attachments are the risky part. sendMessage hands each file to Mastra, and Mastra
// DOWNLOADS any file given as an http(s) URL (`downloadAssetsFromMessages`). An
// unchecked `url` would let a caller make the server fetch an internal address. So a
// file must be an inline `data:` URL, of a media type the models read, under a size
// cap, and the route's whole body is capped too.

import type { registerApiRoute } from '@mastra/core/server';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

/** The media types a composer attachment may have: images, PDFs and plain text. */
export const ATTACHMENT_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
] as const;

/** At most this many files per message. */
export const MAX_ATTACHMENTS = 4;

/** At most this many bytes per file, decoded (Anthropic's per-image cap). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The route's body cap: every file at its limit as base64 (4 bytes per 3), plus 1 MB
 * for the text and the rest of the JSON.
 */
export const STREAM_BODY_LIMIT =
  Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) * MAX_ATTACHMENTS + 1024 * 1024;

/** The middleware type registerApiRoute takes, from the hono copy @mastra/core uses. */
type RouteMiddleware = Exclude<
  NonNullable<Parameters<typeof registerApiRoute>[1]['middleware']>,
  unknown[]
>;

/**
 * Hono middleware for the route: a bigger body gets a 413 before it is parsed. (Custom
 * API routes don't get Mastra's own `server.bodySizeLimit`, so the route sets its own.)
 * Typed as Mastra's middleware because a project's `hono` can be a different 4.x copy
 * from the one @mastra/core resolves, and the two copies' types never match each other.
 * At runtime it is the same Hono middleware.
 */
export const streamBodyLimit = bodyLimit({
  maxSize: STREAM_BODY_LIMIT,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}) as unknown as RouteMiddleware;

/** The decoded size of a base64 payload. */
function base64Bytes(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

const attachment = z
  .object({
    // Only `data:<type>;base64,<payload>`. No http(s), blob:, file: or any other scheme.
    url: z.string().regex(/^data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/i, {
      message: 'url must be a base64 data: URL',
    }),
    mediaType: z.enum(ATTACHMENT_MEDIA_TYPES),
    filename: z.string().max(255).optional(),
  })
  .superRefine((file, ctx) => {
    const comma = file.url.indexOf(',');
    // The data URL's own type must be the declared one.
    if (file.url.slice('data:'.length, file.url.indexOf(';')).toLowerCase() !== file.mediaType) {
      ctx.addIssue({ code: 'custom', message: 'the data URL type does not match mediaType' });
    }
    if (base64Bytes(file.url.slice(comma + 1)) > MAX_ATTACHMENT_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `a file may be at most ${MAX_ATTACHMENT_BYTES} bytes`,
      });
    }
  });

export const streamBodySchema = z
  .object({
    text: z.string().optional(),
    threadId: z.string().optional(),
    model: z.string().optional(),
    // The composer's Plan toggle: 'plan' | 'chat'. Unknown ids are ignored later.
    mode: z.string().optional(),
    webSearch: z.boolean().optional(),
    // The composer's attachments (FileUIPart), `url` already converted to a data URL
    // by the client at submit time.
    files: z.array(attachment).max(MAX_ATTACHMENTS).optional(),
  })
  // Whitespace-only text is no text; real text is passed on as typed.
  .transform((body) => ({ ...body, text: body.text?.trim() ? body.text : '' }))
  // An attachment alone is a message too (the composer sends an image with no text).
  .refine((body) => body.text !== '' || (body.files?.length ?? 0) > 0, {
    message: 'text or files is required',
  });

export type StreamBody = z.infer<typeof streamBodySchema>;
