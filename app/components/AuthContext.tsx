'use client';

import React, { createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';

// Login/logout actions only.
//
// This context no longer gates access to anything. Route protection lives in
// middleware.ts, which verifies the signed session cookie at the edge before a
// page is ever rendered. A client-side flag is not an access control — it can be
// flipped in devtools — so keeping one here would only invite reliance on it.

interface AuthContextType {
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();

  const login = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json().catch(() => ({ success: false }));
      return response.ok && data.success === true;
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
      // refresh() clears the client router cache so no authenticated page stays
      // rendered from cache after the cookie is gone.
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <AuthContext.Provider value={{ login, logout }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
