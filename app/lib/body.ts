import 'server-only';

// Bounded JSON body reading.
//
// App Router route handlers have no default request-body size limit (unlike the
// old Pages Router API routes, which capped at 4 MB). `await request.json()`
// buffers the whole body into memory before any validation runs, so the cap has
// to happen here.

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — generous for these payloads.

// The one route allowed more: a whole rally imported from an export file
// (POST /api/rallies/import) carries every stage key and every answer sheet,
// which is several hundred KB on a real rally. Admin-only, like the route.
export const RALLY_IMPORT_MAX_BODY_BYTES = 5 * 1024 * 1024;

export class BodyTooLargeError extends Error {}
export class InvalidJsonError extends Error {}

// Read the body as text, never holding more than MAX_BODY_BYTES of it.
//
// `request.text()` cannot do this: it buffers the whole stream before a single
// byte can be counted, so a chunked request with no Content-Length — which the
// header check below never sees — could push gigabytes into memory before the
// size check ran, on the public app endpoints as much as anywhere. Reading the
// stream chunk by chunk and cancelling it the moment the cap is passed is what
// bounds the memory a request can take.
async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      // Stop the upload rather than draining it; a failed cancel changes nothing.
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES
): Promise<unknown> {
  // A declared length over the cap is refused before anything is read. A
  // declared length that is not a plain byte count is refused too — it is not
  // something a real client sends. An absent one is fine: the stream is
  // counted as it is read either way, so the header is only a shortcut.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d{1,15}$/.test(declared.trim())) throw new InvalidJsonError();
    if (Number(declared) > maxBytes) throw new BodyTooLargeError();
  }

  const text = await readBoundedText(request, maxBytes);

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
