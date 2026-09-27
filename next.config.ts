import type { NextConfig } from "next";

// Content-Security-Policy.
//
// script-src keeps 'unsafe-inline' rather than using a per-request nonce. A
// nonce has to be minted in middleware and matched against the nonce Next.js
// stamps onto its inline bootstrap — which only works for dynamically rendered
// pages. Several pages here (/, /login, /rallies, /rallies/new) are statically
// prerendered, so their HTML is generated at build time and cannot carry a
// per-request nonce: the two never match, every script is refused, and the app
// does not hydrate at all. (Verified in a browser — the login form went inert.)
//
// Forcing every page dynamic would make nonces work, at the cost of static
// rendering and a trap where any future static page silently breaks. Given the
// app has no HTML-injection sink — no dangerouslySetInnerHTML, no eval, no
// dynamic script construction — the remaining directives carry the real weight
// here: frame-ancestors stops clickjacking, form-action stops form hijacking,
// base-uri stops <base> injection, and connect-src stops exfiltration.
//
// If a nonce is wanted later, the change is: add `export const dynamic =
// 'force-dynamic'` to the root layout, then mint the nonce in middleware and
// forward it on the request headers.
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  // React's dev build and fast-refresh need eval; production does not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // next/font/google self-hosts at build time, so no external font origin.
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Without `preload`: that flag only means something once the domain has
  // been submitted to hstspreload.org, and submitting it would pin HTTPS on
  // every subdomain of it — including sites this app does not own. The header
  // still covers this host and anything under it.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // A page opened from this app (or that opens it) gets no handle on its
  // window, which closes reverse tab-nabbing and cross-window leaks.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Other sites cannot embed this app's responses — its JSON included — as an
  // image, script or other subresource. Same-origin pages are unaffected, and
  // so is the Android app: it is a native HTTP client, not a browser page.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Produce a self-contained build in .next/standalone so the Docker image
  // only needs the server bundle + node runtime (much smaller image).
  output: "standalone",

  // Drop the `X-Powered-By: Next.js` version fingerprint.
  poweredByHeader: false,

  experimental: {
    // Because middleware.ts exists, Next buffers every request body so the
    // middleware could read it and the route handler still can — up to this
    // size, cutting off the rest (default 10 MB). That buffer is held whether or
    // not anything reads it, so it is the real per-request memory ceiling,
    // on the public app endpoints as much as anywhere. No payload here is more
    // than readBody()'s 256 KB (app/lib/body.ts), so 1 MB is headroom, not a
    // limit anyone meets: a larger body is cut off here and refused there with
    // a 413.
    middlewareClientMaxBodySize: "1mb",
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
