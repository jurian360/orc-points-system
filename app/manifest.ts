import type { MetadataRoute } from 'next';

// Makes the app installable, so the laptop an official takes into the field
// opens it from a desktop icon without a connection — straight into the offline
// workspace, which the service worker (public/sw.js) keeps cached. Served at
// /manifest.webmanifest, a public path in middleware.ts: a browser fetches it
// without the session cookie it needs to read anything else.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SARK Points System',
    short_name: 'SARK Points',
    description: 'Score SARK rally control cards — online, or offline in the field.',
    start_url: '/offline',
    scope: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    icons: [{ src: '/sark-logo.png', sizes: '300x300', type: 'image/png', purpose: 'any' }],
  };
}
