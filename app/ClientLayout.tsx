'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from './components/AuthContext';
import { ROLE_LABELS } from './lib/roles';
import { PAGE_CONTAINER } from './lib/pageContainer';
import { useOfflineSync } from './lib/offline/useOfflineSync';
import { clearOfflineData, listOfflineRallies, pendingCount } from './lib/offline/store';

const NAV_LINK_CLASS =
  'block text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium';

const Navigation: React.FC = () => {
  const { user, loading, can, logout, refresh } = useAuth();
  const isAdmin = can('manage:rally');
  const pathname = usePathname();
  // The cards typed in the offline workspace and not uploaded yet; uploaded on
  // their own once there is a connection and a session.
  const { pending } = useOfflineSync(Boolean(user), refresh);
  // Home, Rallies and (for an admin) Import Times / Users live behind a
  // hamburger below `sm`. At the widths this app is actually read on — a
  // phone in an official's hand, mid-rally — there is no room to lay all four
  // out next to the logo and the account controls without either wrapping the
  // header onto a second line or truncating something an official needs to
  // read (their own username).
  const [menuOpen, setMenuOpen] = useState(false);

  // A tapped link should not leave the panel open behind the page it just
  // navigated to.
  useEffect(() => setMenuOpen(false), [pathname]);

  const links = (
    <>
      <Link href="/" className={NAV_LINK_CLASS}>
        Home
      </Link>
      <Link href="/rallies" className={NAV_LINK_CLASS}>
        Rallies
      </Link>
      <Link href="/offline" className={NAV_LINK_CLASS} title="Work on a rally without a connection">
        Offline
        {pending > 0 && (
          <span
            className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-xs font-bold"
            title={`${pending} card${pending === 1 ? '' : 's'} waiting to be uploaded`}
          >
            {pending}
          </span>
        )}
      </Link>
      {/* The admin links are hidden for a data-entry account. Hiding is
          a courtesy, not the control: middleware.ts redirects the page
          and every route behind it answers 403. Nothing renders until
          /api/auth/check has answered, so the links do not flash away
          from an admin. */}
      {!loading && isAdmin && (
        <>
          <Link href="/time-import" className={NAV_LINK_CLASS}>
            Import Times
          </Link>
          <Link href="/users" className={NAV_LINK_CLASS}>
            Users
          </Link>
        </>
      )}
    </>
  );

  // Logging out leaves the offline copy of a rally on the device unless the
  // official says otherwise — and never throws away cards that were not uploaded:
  // those stay, and go up after the next login.
  const handleLogout = async () => {
    try {
      const waiting = await pendingCount();
      if (waiting > 0) {
        const proceed = window.confirm(
          `${waiting} card${waiting === 1 ? ' is' : 's are'} not uploaded yet. ` +
            'They stay on this device and are uploaded after the next login. Log out?'
        );
        if (!proceed) return;
      } else if ((await listOfflineRallies()).length > 0) {
        if (window.confirm('Also remove the rallies downloaded for offline use from this device?')) {
          await clearOfflineData();
        }
      }
    } catch (error) {
      // No offline storage in this browser: nothing to keep or clear.
      console.warn(error);
    }
    logout();
  };

  // The nav is never printed. Every printable view of this app — the results
  // on A4, the sheet of QR codes — is a page of paper an official hands out,
  // and the app's own header on top of it is not part of the document.
  return (
    <nav className="bg-blue-600 shadow-md print:hidden">
      <div className={PAGE_CONTAINER}>
        <div className="flex justify-between items-center h-16 gap-2">
          <div className="flex items-center min-w-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="sm:hidden -ml-2 mr-1 flex-shrink-0 p-2 rounded-md text-white hover:bg-blue-700"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            <Link href="/" className="flex items-center gap-2.5 text-white text-xl font-bold min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/sark-logo.png"
                alt="SARK Points System"
                className="h-9 w-9 rounded-full shadow-sm flex-shrink-0"
              />
              {/* The full name only fits once the hamburger and its links are
                  gone; below that the logo already carries the name. */}
              <span className="hidden sm:inline truncate">SARK Points System</span>
            </Link>

            <div className="hidden sm:flex sm:items-center sm:ml-6 sm:space-x-2">{links}</div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {user && (
              <Link
                href="/account"
                className="block max-w-[8rem] sm:max-w-none truncate text-white hover:text-blue-200 px-2 sm:px-3 py-2 rounded-md text-sm font-medium"
                title="Your account"
              >
                <span className="font-semibold">{user.username}</span>
                <span className="hidden sm:inline text-blue-200">
                  {' '}
                  ({ROLE_LABELS[user.role]})
                </span>
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="text-white hover:text-blue-200 px-2 sm:px-3 py-2 rounded-md text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>

        {menuOpen && <div className="sm:hidden flex flex-col gap-0.5 pb-3">{links}</div>}
      </div>
    </nav>
  );
};

// The login screen is its own route (/login) rather than a conditional render
// over every page, so middleware has somewhere to redirect unauthenticated
// visitors to. Everything else renders behind the nav; middleware has already
// verified the session by the time this runs.
//
// A rally's public results page (/public/rallies/[id]) is the other
// exception: it is reached by anyone with the link or a printed QR code, most
// of them with no account at all, so the officials' own nav — Rallies, Users,
// Logout — would be both useless to them and a set of links middleware would
// only bounce them out of. It builds its own minimal header instead.
const noNav = (pathname: string) => pathname === '/login' || pathname.startsWith('/public/');

const ClientLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  return (
    <AuthProvider>
      {noNav(pathname) ? (
        <main>{children}</main>
      ) : (
        <>
          <Navigation />
          <main>{children}</main>
        </>
      )}
    </AuthProvider>
  );
};

export default ClientLayout;
