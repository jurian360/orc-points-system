'use client';

// The app-wide half of the offline workspace (see "Offline mode" in CLAUDE.md):
// registers the service worker, counts the cards waiting to be uploaded, and
// uploads them on its own as soon as the browser has a connection again — so an
// official who comes back into coverage does not have to remember to open the
// workspace. A card in conflict is left for the workspace, where an official
// chooses.
//
// The upload does not wait for the auth context to say "signed in": a page
// opened without a connection checked the session then, failed, and keeps
// saying "signed out" after the connection is back. The upload simply tries;
// a session that really ran out answers 401 and the cards stay queued until
// the official logs in — which runs the upload again (`signedIn` changes).

import { useEffect, useState } from 'react';
import {
  listOfflineRallies,
  OFFLINE_CHANGE_EVENT,
  pendingCount,
  syncRally,
} from './store';

export function useOfflineSync(signedIn: boolean, refreshSession?: () => Promise<void>) {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // Development builds change their scripts on every save; a cached copy of
    // them would only get in the way. `next build` sets NODE_ENV=production.
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.error('Could not register the service worker:', error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const count = await pendingCount();
      if (!cancelled) setPending(count);
    };

    const upload = async () => {
      if (!navigator.onLine) return;
      try {
        const rallies = await listOfflineRallies();
        for (const rally of rallies) {
          if (rally.pending > rally.conflicts) await syncRally(rally.rallyId);
        }
      } catch (error) {
        // No connection after all, or the session ran out: the cards stay
        // queued and the workspace says why.
        console.warn('Automatic upload did not complete:', error);
      }
      refresh();
    };

    // Back in coverage: ask who is signed in again (the nav was told "nobody"
    // while there was no connection), and upload.
    const reconnected = () => {
      refreshSession?.().catch(() => {});
      upload();
    };

    refresh();
    upload();
    window.addEventListener(OFFLINE_CHANGE_EVENT, refresh);
    window.addEventListener('online', reconnected);
    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_CHANGE_EVENT, refresh);
      window.removeEventListener('online', reconnected);
    };
  }, [signedIn, refreshSession]);

  return { pending };
}
