'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from './components/AuthContext';
import { ROLE_LABELS } from './lib/roles';
import { PAGE_CONTAINER } from './lib/layout';

const Navigation: React.FC = () => {
  const { user, loading, can, logout } = useAuth();
  const isAdmin = can('manage:rally');
  // A rider sees one page and their account. Everything else in this app is
  // the officials', and middleware.ts sends them back from it — so the nav
  // must not offer it in the first place.
  const isParticipant = user?.role === 'participant';

  // The nav is never printed. Every printable view of this app — the results
  // on A4, the sheet of QR codes — is a page of paper an official hands out,
  // and the app's own header on top of it is not part of the document.
  return (
    <nav className="bg-blue-600 shadow-md print:hidden">
      <div className={PAGE_CONTAINER}>
        <div className="flex justify-between items-center h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="flex items-center gap-2.5 text-white text-xl font-bold">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/sark-logo.png" alt="" className="h-9 w-9 rounded-full shadow-sm" />
                SARK Points System
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {/* Nothing renders until /api/auth/check has answered, so no
                  link flashes away from the account that may use it. */}
              {!loading && isParticipant && (
                <Link
                  href="/participant"
                  className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                >
                  My rallies
                </Link>
              )}
              {!loading && !isParticipant && (
                <>
                  <Link
                    href="/"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Home
                  </Link>
                  <Link
                    href="/rallies"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Rallies
                  </Link>
                  {/* Both are read pages for every official — a data-entry
                      account picks crews out of the register, and a
                      classification admin lives in it. */}
                  <Link
                    href="/persons"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Members
                  </Link>
                  <Link
                    href="/standings/overall"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Overall
                  </Link>
                </>
              )}
              {/* The admin links are hidden for a data-entry account. Hiding is
                  a courtesy, not the control: middleware.ts redirects the page
                  and every route behind it answers 403. Nothing renders until
                  /api/auth/check has answered, so the links do not flash away
                  from an admin. */}
              {!loading && !isParticipant && isAdmin && (
                <>
                  <Link
                    href="/time-import"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Import Times
                  </Link>
                  <Link
                    href="/results-import"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                    title="Import the results of a rally ridden before this system"
                  >
                    Import Results
                  </Link>
                  <Link
                    href="/users"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Users
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {user && (
              <Link
                href="/account"
                className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
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
              onClick={logout}
              className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

// The login screen is its own route (/login) rather than a conditional render
// over every page, so middleware has somewhere to redirect unauthenticated
// visitors to. Everything else renders behind the nav; middleware has already
// verified the session by the time this runs.
const ClientLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  return (
    <AuthProvider>
      {pathname === '/login' ? (
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
