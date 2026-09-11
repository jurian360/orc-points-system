'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from '../lib/roles';

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const success = await onLogin(username, password);
      if (success) {
        setPassword('');
        // replace() keeps /login out of the history stack; refresh() re-runs
        // middleware so the new session cookie is picked up immediately.
        router.replace('/');
        router.refresh();
      } else {
        // One message for a wrong username and a wrong password: the form must
        // not become a way to find out which accounts exist.
        setError('Invalid username or password. Please try again.');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 ' +
    'placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 ' +
    'focus:border-indigo-500 focus:z-10 sm:text-sm';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sark-logo.png"
            alt="SARK — Surinaamse Auto Rally Klub"
            className="mx-auto h-20 w-20"
          />
          <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900">
            SARK Points System
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Officials sign in with their username, participants with their e-mail address
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <div>
              <label htmlFor="username" className="sr-only">
                Username or e-mail address
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={MAX_USERNAME_LENGTH}
                required
                className={inputClass}
                placeholder="Username or e-mail address"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={MAX_PASSWORD_LENGTH}
                required
                className={inputClass}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {error && <div className="text-red-600 text-sm text-center">{error}</div>}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
