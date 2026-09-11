'use client';

import React, { useState } from 'react';
import {
  EMAIL_RULE,
  isValidEmail,
  isValidUsername,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizeUsername,
  PASSWORD_RULE,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  USERNAME_RULE,
  type Role,
} from '../lib/roles';

export interface UserValue {
  _id: string;
  username: string;
  email?: string;
  role: Role;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  createdAt?: string;
}

interface UserFormProps {
  // The account being edited, or undefined to add one. Editing makes the
  // password optional: it is a reset, and an admin who only changes a role
  // should not have to invent a password to do it.
  user?: UserValue;
  onSaved: (user: UserValue) => void;
  onCancel: () => void;
}

// Add an account or correct one. Shared by both paths on /users so the rules
// the form checks cannot drift apart between them — the same reason
// ParticipantDetailsForm is shared by the add and the edit of a crew.
const UserForm: React.FC<UserFormProps> = ({ user, onSaved, onCancel }) => {
  const isEditing = Boolean(user);
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'data-entry');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) {
      setError(USERNAME_RULE);
      return;
    }

    // Optional: '' is a valid value, meaning "no email on file yet".
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      setError(EMAIL_RULE);
      return;
    }

    // On an edit an empty password means "leave it alone"; on a new account it
    // is the one thing that cannot be left out.
    if (!isEditing || password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(PASSWORD_RULE);
        return;
      }
    }

    setSaving(true);

    try {
      const body: Record<string, unknown> = { username: normalized, email: normalizedEmail, role };
      if (password) body.password = password;

      const response = await fetch(isEditing ? `/api/users/${user!._id}` : '/api/users', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not save this account.');
        return;
      }

      onSaved(data as UserValue);
    } catch {
      setError('Could not save this account.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 ' +
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="user-username" className="block text-sm font-medium text-gray-700">
          Username
        </label>
        <input
          id="user-username"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_USERNAME_LENGTH}
          required
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-gray-500">{USERNAME_RULE}</p>
      </div>

      <div>
        <label htmlFor="user-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="user-email"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_EMAIL_LENGTH}
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-gray-500">
          Optional. Needed for this account to use &quot;Forgot your password?&quot;.
        </p>
      </div>

      <div>
        <label htmlFor="user-role" className="block text-sm font-medium text-gray-700">
          Role
        </label>
        <select
          id="user-role"
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={saving}
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">{ROLE_DESCRIPTIONS[role]}</p>
      </div>

      <div>
        <label htmlFor="user-password" className="block text-sm font-medium text-gray-700">
          {isEditing ? 'New password (leave empty to keep the current one)' : 'Password'}
        </label>
        <input
          id="user-password"
          type="password"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          required={!isEditing}
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-gray-500">
          {PASSWORD_RULE}
          {isEditing ? ' Setting one signs this account out everywhere.' : ''}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEditing ? 'Save account' : 'Add account'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md font-medium hover:bg-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default UserForm;
