/**
 * Tiny in-process image cache. The `generateImage` tool stores the (large) image
 * base64 here and returns only a small `imageId` to the agent — so the bytes never
 * enter the model's context (a full image base64 would overflow it and trip the
 * output TokenLimiter). The bytes are served back to the UI via GET /images/:id.
 *
 * Reference scope: a bounded in-memory map (last N images), single process.
 */

type StoredImage = { base64: string; mediaType: string };

const MAX_IMAGES = 32;
const store = new Map<string, StoredImage>();

/** Store image bytes; returns a short id. Evicts the oldest beyond MAX_IMAGES. */
export function putImage(base64: string, mediaType: string, id: string): string {
  store.set(id, { base64, mediaType });
  while (store.size > MAX_IMAGES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    store.delete(oldest);
  }
  return id;
}

export function getImage(id: string): StoredImage | undefined {
  return store.get(id);
}
