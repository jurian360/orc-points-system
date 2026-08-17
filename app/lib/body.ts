import 'server-only';

// Bounded JSON body reading.
//
// App Router route handlers have no default request-body size limit (unlike the
// old Pages Router API routes, which capped at 4 MB). `await request.json()`
// buffers the whole body into memory before any validation runs, so the cap has
// to happen here.

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — generous for these payloads.

export class BodyTooLargeError extends Error {}
export class InvalidJsonError extends Error {}

export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }

  const text = await request.text();

  // content-length can be absent or wrong under chunked transfer encoding, so
  // the actual byte length is what we enforce on.
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidJsonError();
  }

  // Reject arrays and primitives: every endpoint expects a JSON object, and
  // accepting other shapes just pushes the type confusion downstream.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidJsonError();
  }

  return parsed;
}
