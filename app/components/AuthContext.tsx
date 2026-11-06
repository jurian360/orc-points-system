'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { can, type Permission, type Role } from '../lib/roles';

// Who is signed in, and the login/logout actions.
//
// This context does not gate access to anything. Route protection lives in
// proxy.ts (which verifies the signed session cookie at the edge and keeps
// a data-entry account off the admin pages) and in the per-route guards. A
// client-side flag is not an access control — it can be flipped in devtools —
// so what `can()` does here is hide buttons that would answer 403, nothing more.

export interface CurrentUser {
  username: string;
  role: Role;
  // '' for the environment admin, which has no email on file (see
  // app/lib/users.ts).
  email: string;
  // The recovery admin configured in the environment: no document, so no
  // email to set and no /api/users entry. The account page reads this to hide
  // the email form instead of letting it fail on submit.
  isEnvAdmin: boolean;
}

interface AuthContextType {
  user: CurrentUser | null;
  // Null until /api/auth/check has answered; the nav renders nothing role-
  // dependent before that, so an admin never sees their buttons flash away.
  loading: boolean;
  can: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/check');
      const data = await response.json().catch(() => ({ authenticated: false }));

      setUser(
        data.authenticated && typeof data.username === 'string'
          ? {
              username: data.username,
              role: data.role as Role,
              email: data.email || '',
              isEnvAdmin: data.isEnvAdmin === true,
            }
          : null
      );
    } catch (error) {
      console.error('Session check error:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json().catch(() => ({ success: false }));
      if (!response.ok || data.success !== true) return false;

      setUser(data.user ?? null);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/login', { method: 'DELETE' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      // refresh() clears the client router cache so no authenticated page stays
      // rendered from cache after the cookie is gone.
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        can: (permission: Permission) => can(user?.role, permission),
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
