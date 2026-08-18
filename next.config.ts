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
  // 'wasm-unsafe-eval' is the narrow grant the controlekaart scanner needs:
  // Tesseract.js compiles its WebAssembly core inside a worker, and with a
  // restrictive script-src that is refused without it. It permits WebAssembly
  // compilation only — not eval() or new Function().
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // next/font/google self-hosts at build time, so no external font origin.
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  // The OCR worker and its wasm core are self-hosted under /ocr (staged by
  // scripts/setup-ocr-assets.mjs), and tesseract.js is configured with
  // workerBlobURL:false, so 'self' is enough — no blob: worker is ever created.
  "worker-src 'self'",
  "child-src 'self'",
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
    // camera=(self): the answer-sheet scanner captures the paper controlekaart
    // in-page. Everything else stays denied, and cross-origin frames get
    // nothing — the allow-list is this origin only.
    value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Produce a self-contained build in .next/standalone so the Docker image
  // only needs the server bundle + node runtime (much smaller image).
  output: "standalone",

  // Drop the `X-Powered-By: Next.js` version fingerprint.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The OCR runtime is ~10 MB of wasm and language model that only changes
        // when tesseract.js is upgraded. Without this it revalidates on every
        // scan, which is four round trips on rally-site mobile data. A day
        // bounds how long a stale copy can survive an upgrade.
        source: "/ocr/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
