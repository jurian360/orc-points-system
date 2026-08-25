'use client';

import React, { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULE,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '../lib/roles';

// Your own account: who you are signed in as, and the one thing you may change
// about it. Every role can open this — resetting somebody *else's* password is
// on /users and is an admin's.
export default function AccountPage() {
  const { user, loading } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (newPassword !== confirmPassword) {
      setError('The two new passwords are not the same.');
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(PASSWORD_RULE);
      return;
    }

    setSaving(true);

    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not change the password.');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
    } catch {
      setError('Could not change the password.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 ' +
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Your account</h1>

      <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-8">
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : user ? (
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-500">Username</dt>
              <dd className="font-medium text-gray-900">{user.username}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Role</dt>
              <dd className="font-medium text-gray-900">{ROLE_LABELS[user.role]}</dd>
            </div>
            <p className="text-sm text-gray-500 pt-2 border-t border-gray-100">
              {ROLE_DESCRIPTIONS[user.role]}
            </p>
          </dl>
        ) : (
          <p className="text-gray-500">Not signed in.</p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Change your password</h2>
        <p className="text-sm text-gray-500 mb-5">
          {PASSWORD_RULE} Changing it signs you out everywhere else.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={MAX_PASSWORD_LENGTH}
              className={inputClass}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
              New password again
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              className={inputClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={saving}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-700">Your password has been changed.</p>}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
