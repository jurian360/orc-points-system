'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { MAX_EMAIL_LENGTH } from '../lib/roles';

// Request a reset link. Public — see proxy.ts's PUBLIC_PATHS — because a
// visitor asking for this has no session yet, the same reason /login is.
//
// The API answers `{ success: true }` for every well-formed request whether or
// not the address has an account (see app/api/auth/forgot-password/route.ts),
// so this form shows the same message either way rather than branching on the
// response body.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        // Only a malformed request (429, a body the reader rejected) lands
        // here — a valid address that has no account still answers 200.
        setError('Something went wrong. Please try again.');
        return;
      }

      setDone(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 ' +
    'placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 ' +
    'focus:border-indigo-500 focus:z-10 sm:text-sm';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            Forgot your password?
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter the email on your account and we will send you a link to choose a new
            password.
          </p>
        </div>

        {done ? (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            If that address has an account, a reset link is on its way. Check your inbox — the
            link works for one hour.
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={MAX_EMAIL_LENGTH}
                required
                className={inputClass}
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && <div className="text-red-600 text-sm text-center">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link href="/login" className="text-indigo-600 hover:text-indigo-500">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
