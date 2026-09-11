'use client';

import React, { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import {
  EMAIL_RULE,
  isValidEmail,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  PASSWORD_RULE,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '../lib/roles';

// Your own account: who you are signed in as, and the one thing you may change
// about it. Every role can open this — resetting somebody *else's* password is
// on /users and is an admin's.
export default function AccountPage() {
  const { user, loading, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState(user?.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailEdited, setEmailEdited] = useState(false);

  // The field starts empty until /api/auth/check answers; once it has, take
  // its value unless the official has already started typing a change.
  const emailValue = emailEdited ? email : (user?.email ?? email);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSaved(false);

    const normalized = normalizeEmail(emailValue);
    if (normalized && !isValidEmail(normalized)) {
      setEmailError(EMAIL_RULE);
      return;
    }

    setSavingEmail(true);

    try {
      const response = await fetch('/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, currentPassword: emailPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setEmailError(data.error || 'Could not change the email.');
        return;
      }

      setEmailPassword('');
      setEmailEdited(false);
      setEmailSaved(true);
      await refresh();
    } catch {
      setEmailError('Could not change the email.');
    } finally {
      setSavingEmail(false);
    }
  };

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
            {!user.isEnvAdmin && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Email</dt>
                <dd className="font-medium text-gray-900">{user.email || '—'}</dd>
              </div>
            )}
            <p className="text-sm text-gray-500 pt-2 border-t border-gray-100">
              {ROLE_DESCRIPTIONS[user.role]}
            </p>
          </dl>
        ) : (
          <p className="text-gray-500">Not signed in.</p>
        )}
      </div>

      {user && !user.isEnvAdmin && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Email</h2>
          <p className="text-sm text-gray-500 mb-5">
            Needed to use &quot;Forgot your password?&quot; on the sign-in page.
          </p>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label htmlFor="accountEmail" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="accountEmail"
                type="email"
                autoComplete="email"
                maxLength={MAX_EMAIL_LENGTH}
                className={inputClass}
                value={emailValue}
                onChange={(e) => {
                  setEmailEdited(true);
                  setEmail(e.target.value);
                }}
                disabled={savingEmail}
              />
            </div>

            <div>
              <label htmlFor="emailCurrentPassword" className="block text-sm font-medium text-gray-700">
                Current password
              </label>
              <input
                id="emailCurrentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                className={inputClass}
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                disabled={savingEmail}
              />
              <p className="mt-1 text-xs text-gray-500">
                Confirms this is you — an email on file can be used to reset the password.
              </p>
            </div>

            {emailError && <p className="text-sm text-red-600">{emailError}</p>}
            {emailSaved && <p className="text-sm text-green-700">Your email has been saved.</p>}

            <button
              type="submit"
              disabled={savingEmail}
              className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingEmail ? 'Saving…' : 'Save email'}
            </button>
          </form>
        </div>
      )}

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
