// The service worker of the offline workspace (see "Offline mode" in
// CLAUDE.md). Hand-written, no build step and no library: it does three things
// and nothing else.
//
//   1. It keeps `/offline` — the workspace page — and every script, style and
//      font that page loads in a cache, so the page opens with no connection.
//      The page is network-first (with a short timeout): online it is always
//      this deployment's version, and every time it is fetched the cache is
//      rebuilt from the scripts that version references.
//   2. `/_next/static/` is cache-first: those files are named after their
//      content, so a cached copy is never stale.
//   3. Any other page that cannot be reached is answered with a redirect to
//      `/offline`, so an official who opens the app without a connection lands
//      in the workspace instead of on the browser's error page.
//
// It never touches `/api/`. The workspace's data lives in IndexedDB
// (app/lib/offline/db.ts), downloaded and uploaded by the page itself; a cached
// API answer would be a second copy of the rally that nothing keeps current.
//
// Bump VERSION when this file changes in a way the old cache cannot survive.

const VERSION = 'v1';
const SHELL_CACHE = `sark-offline-shell-${VERSION}`;
const OFFLINE_URL = '/offline';
const NETWORK_TIMEOUT_MS = 4000;

// Every same-origin asset the workspace HTML refers to: the <script>, <link>
// and font URLs, and the chunk paths in the inline React Server Components
// payload (written there without the `/_next/` prefix).
function assetsOf(html) {
  const assets = new Set(['/sark-logo.png', '/manifest.webmanifest']);
  for (const match of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) {
    assets.add(match[0]);
  }
  for (const match of html.matchAll(/(?:^|["'\s(])(static\/(?:chunks|css|media)\/[^"'\\\s)<>]+)/g)) {
    assets.add(`/_next/${match[1]}`);
  }
  return assets;
}

// `fetched` is a response for /offline the caller already has; otherwise the
// page is fetched here.
async function cacheShell(fetched) {
  const response = fetched || (await fetch(OFFLINE_URL, { cache: 'no-store' }));
  // A redirect (to /login, say) is not the workspace; keep what is cached.
  if (!response.ok || response.redirected) return;

  const html = await response.clone().text();
  const assets = assetsOf(html);
  const cache = await caches.open(SHELL_CACHE);

  const store = (urls) =>
    Promise.all(
      Array.from(urls).map(async (url) => {
        if (await cache.match(url)) return;
        try {
          const asset = await fetch(url);
          if (asset.ok) await cache.put(url, asset);
        } catch {
          // One asset that will not load does not keep the rest from caching.
        }
      })
    );

  await store(assets);

  // The fonts are named inside the stylesheets, not in the page.
  const fonts = new Set();
  for (const url of assets) {
    if (!url.endsWith('.css')) continue;
    const css = await cache.match(url);
    if (!css) continue;
    for (const match of (await css.text()).matchAll(/\/_next\/static\/media\/[^"'\\\s)]+/g)) {
      fonts.add(match[0]);
    }
  }
  await store(fonts);
  for (const font of fonts) assets.add(font);

  await cache.put(OFFLINE_URL, response);

  // Drop what an earlier deployment's page needed and this one does not, so the
  // cache does not grow with every release.
  const keep = new Set([OFFLINE_URL, ...assets]);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!keep.has(path)) await cache.delete(request);
  }
}

// A cache that cannot be read (storage refused or cleared) reads as a miss.
const cachedPage = () => caches.match(OFFLINE_URL).catch(() => undefined);

// Resolves with the response, or with null when `ms` pass first.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(cacheShell().catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('sark-offline-shell-') && name !== SHELL_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })()
  );
});

// The page asks for this after it downloads a rally (app/lib/offline/store.ts).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-offline-shell') {
    event.waitUntil(cacheShell().catch(() => {}));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        // A cache that cannot be read or written (a full disk, a refused
        // quota, a browser that keeps no storage) must never cost the online
        // app a script: every cache step here falls back to the network.
        const cached = await caches.match(request).catch(() => undefined);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => {})
          );
        }
        return response;
      })()
    );
    return;
  }

  if (request.mode !== 'navigate') {
    // The logo and the manifest: from the cache when the network is gone.
    if (url.pathname === '/sark-logo.png' || url.pathname === '/manifest.webmanifest') {
      event.respondWith(
        fetch(request).catch(async () => {
          const cached = await caches.match(url.pathname).catch(() => undefined);
          return cached || Response.error();
        })
      );
    }
    return;
  }

  if (url.pathname === OFFLINE_URL) {
    event.respondWith(
      (async () => {
        const network = fetch(request);
        try {
          // A slow connection gets the cached page after a few seconds — but
          // only if there is one; otherwise the network is waited for.
          let response = await withTimeout(network, NETWORK_TIMEOUT_MS);
          if (!response) {
            const cached = await cachedPage();
            if (cached) return cached;
            response = await network;
          }
          if (response.ok && !response.redirected) {
            // Rebuild the cache from what this version of the page loads.
            event.waitUntil(cacheShell(response.clone()).catch(() => {}));
            return response;
          }
          return (await cachedPage()) || response;
        } catch {
          const cached = await cachedPage();
          if (cached) return cached;
          return new Response('The offline workspace is not available on this device yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      if (await cachedPage()) return Response.redirect(OFFLINE_URL, 302);
      return new Response('No connection, and this device has no offline copy of the app.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })
  );
});
