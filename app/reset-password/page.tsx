'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../lib/roles';

// Finish a forgot-password request. Public — see middleware.ts's
// PUBLIC_PATHS — the token in the URL is the whole credential, the same way
// the code behind a QR is for the Android app.
//
// `useSearchParams` needs a Suspense boundary in the App Router (the same
// reason /time-import/page.tsx wraps its reader in one), so the token read is
// split into an inner component.
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('The two passwords are not the same.');
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(PASSWORD_RULE);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not reset the password.');
        return;
      }

      // The route signed this browser in on success, the way /api/auth/password
      // re-issues its own cookie — land back in the app, not at a second login.
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reset the password.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 ' +
    'placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 ' +
    'focus:border-indigo-500 focus:z-10 sm:text-sm';

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-4 text-center">
          <h2 className="text-2xl font-extrabold text-gray-900">Invalid reset link</h2>
          <p className="text-sm text-gray-600">
            This link is missing its token. Request a new one from the forgot-password page.
          </p>
          <Link href="/forgot-password" className="text-indigo-600 hover:text-indigo-500 text-sm">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            Choose a new password
          </h2>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="newPassword" className="sr-only">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              required
              className={inputClass}
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="sr-only">
              New password again
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              required
              className={inputClass}
              placeholder="New password again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          <p className="text-xs text-gray-500">{PASSWORD_RULE}</p>

          {error && <div className="text-red-600 text-sm text-center">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>

        <p className="text-center text-sm">
          <Link href="/login" className="text-indigo-600 hover:text-indigo-500">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-500">Loading…</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
