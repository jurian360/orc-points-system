// Fixed-window rate limiter.
//
// State is per-process and in-memory, which is correct for the single-container
// Coolify deployment this app targets. If it is ever scaled to more than one
// instance, replace the Map with a shared store (Redis / @upstash/ratelimit) —
// otherwise each instance enforces the limit independently and the effective
// limit multiplies by the instance count.
//
// No setInterval here: this module is imported by proxy.ts, which runs on
// the Edge runtime where long-lived timers are not available. Expired entries
// are evicted lazily instead.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Hard ceiling so a flood of distinct keys (spoofed IPs) cannot grow the map
// without bound and turn the limiter itself into the memory-exhaustion vector.
const MAX_TRACKED_KEYS = 10_000;

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

export type RateLimitResult = { ok: boolean; retryAfter: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      evictExpired(now);
      // Still full of live entries: a flood of distinct clients. Drop the
      // oldest bucket (a Map iterates in insertion order) rather than refusing
      // the newcomer. Refusing used to answer 429 to *every* new client — every
      // official trying to sign in included — until the window ran out, which
      // made filling the map the cheapest way to take the app down. Dropping
      // the oldest gives that bucket's owner a fresh count at worst, and only
      // after ten thousand other clients have come in behind it.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    // Delete first so a re-created bucket moves to the back of the order.
    buckets.delete(key);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  return { ok: true, retryAfter: 0 };
}

// How many reverse proxies stand in front of the app. Coolify's Traefik is one;
// a CDN in front of it (Cloudflare, say) makes two. Read per call, not at module
// scope, like every other setting (see app/lib/env.ts), and anything that is not
// a sane whole number falls back to the one proxy Coolify always has.
const DEFAULT_TRUSTED_PROXY_COUNT = 1;
const MAX_TRUSTED_PROXY_COUNT = 10;

function trustedProxyCount(): number {
  const configured = Number(process.env.TRUSTED_PROXY_COUNT);
  return Number.isInteger(configured) && configured >= 1 && configured <= MAX_TRUSTED_PROXY_COUNT
    ? configured
    : DEFAULT_TRUSTED_PROXY_COUNT;
}

// Resolve the client IP for rate-limit keying.
//
// A proxy *appends* the address it was connected from to whatever
// X-Forwarded-For the request arrived with; it does not replace it. So only the
// entries the proxies wrote can be trusted, and those are the ones on the
// right: with one proxy, the right-most entry is the client it saw, and
// everything to the left of it is whatever the client chose to send. Reading
// the left-most entry, as this used to, let anyone rotate the header and get a
// fresh bucket on every request — login brute-force limit included.
//
// Counted from the right, with more than one proxy, the entry `count` places
// from the end is the address the outermost proxy saw. A chain shorter than
// that did not pass through every proxy, so its first entry is the best there is.
//
// X-Real-IP is only the fallback for a request with no X-Forwarded-For at all
// (the app reached directly, as in development): a proxy that trusts its
// forwarded headers passes a client's own X-Real-IP straight through.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const client = chain[Math.max(0, chain.length - trustedProxyCount())];
    if (client) return client.slice(0, 64);
  }
  return request.headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}
