// Fixed-window rate limiter.
//
// State is per-process and in-memory, which is correct for the single-container
// Coolify deployment this app targets. If it is ever scaled to more than one
// instance, replace the Map with a shared store (Redis / @upstash/ratelimit) —
// otherwise each instance enforces the limit independently and the effective
// limit multiplies by the instance count.
//
// No setInterval here: this module is imported by middleware.ts, which runs on
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
      // Still full of live entries: we are under a distributed flood. Fail
      // closed rather than letting the map grow.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  return { ok: true, retryAfter: 0 };
}

// Resolve the client IP for rate-limit keying.
//
// x-forwarded-for is only trustworthy because the app sits behind Coolify's
// reverse proxy, which sets it. If this app is ever exposed directly, this
// header becomes attacker-controlled and the limiter becomes bypassable by
// rotating the header value.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Left-most entry is the original client as recorded by the first proxy.
    const first = forwarded.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  return request.headers.get('x-real-ip')?.slice(0, 64) || 'unknown';
}
