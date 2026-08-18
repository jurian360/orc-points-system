'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from './components/AuthContext';

const Navigation: React.FC = () => {
  const { logout } = useAuth();

  return (
    <nav className="bg-blue-600 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="text-white text-xl font-bold">ORC Points System</Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
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
            </div>
          </div>
          <div>
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
