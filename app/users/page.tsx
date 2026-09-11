'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import UserForm, { type UserValue } from '../components/UserForm';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from '../lib/roles';

// The officials' accounts. Admin only — middleware.ts keeps a data-entry
// account off this page and /api/users refuses them anyway.
export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/users');
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not load the accounts.');
        return;
      }

      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load the accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (target: UserValue) => {
    if (!confirm(`Delete the account "${target.username}"? This cannot be undone.`)) return;

    setError(null);

    try {
      const response = await fetch(`/api/users/${target._id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not delete this account.');
        return;
      }

      setUsers((current) => current.filter((entry) => entry._id !== target._id));
    } catch {
      setError('Could not delete this account.');
    }
  };

  const handleToggleActive = async (target: UserValue) => {
    const nextActive = target.active === false;

    if (
      !nextActive &&
      !confirm(`Deactivate "${target.username}"? They will not be able to sign in until reactivated.`)
    ) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/users/${target._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not update this account.');
        return;
      }

      setUsers((current) =>
        current.map((entry) => (entry._id === target._id ? (data as UserValue) : entry))
      );
    } catch {
      setError('Could not update this account.');
    }
  };

  const adminsInDatabase = users.filter(
    (entry) => entry.role === 'admin' && entry.active !== false
  ).length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        {!adding && editingId === null && (
          <button
            onClick={() => setAdding(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
          >
            Add account
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">The two roles</h2>
        <dl className="space-y-2 text-sm">
          {ROLES.map((role) => (
            <div key={role}>
              <dt className="font-medium text-gray-800">{ROLE_LABELS[role]}</dt>
              <dd className="text-gray-600">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {adding && (
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add an account</h2>
          <UserForm
            onSaved={(saved) => {
              setUsers((current) => [...current, saved]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <div className="p-6 text-gray-600">
            <p className="mb-2">There are no accounts yet.</p>
            <p className="text-sm text-gray-500">
              You are signed in as the recovery admin from the deployment environment. Add the
              accounts the officials will use — the recovery admin stays available whatever
              happens to them.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {users.map((entry) => (
              <li key={entry._id} className="p-4">
                {editingId === entry._id ? (
                  <UserForm
                    user={entry}
                    onSaved={(saved) => {
                      setUsers((current) =>
                        current.map((item) => (item._id === saved._id ? saved : item))
                      );
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900">
                        {entry.username}
                        {currentUser?.username === entry.username && (
                          <span className="ml-2 text-xs font-normal text-gray-500">(you)</span>
                        )}
                        {entry.active === false && (
                          <span className="ml-2 text-xs font-normal text-red-600">Inactive</span>
                        )}
                      </p>
                      <p className="text-sm text-gray-500">
                        {ROLE_LABELS[entry.role]}
                        {entry.email ? ` · ${entry.email}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {entry.lastLoginAt
                          ? `Last login ${new Date(entry.lastLoginAt).toLocaleString()}${
                              entry.lastLoginIp ? ` from ${entry.lastLoginIp}` : ''
                            }`
                          : 'Never signed in'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setAdding(false);
                          setEditingId(entry._id);
                        }}
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(entry)}
                        disabled={currentUser?.username === entry.username}
                        title={
                          currentUser?.username === entry.username
                            ? 'You cannot deactivate your own account.'
                            : undefined
                        }
                        className="px-3 py-1.5 text-sm bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {entry.active === false ? 'Activate' : 'Deactivate'}
                      </button>
                      <button
                        onClick={() => handleDelete(entry)}
                        className="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-md hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && users.length > 0 && adminsInDatabase <= 1 && (
        <p className="mt-4 text-sm text-gray-500">
          There is one admin account. The last admin cannot be deleted or demoted — add a second
          one first.
        </p>
      )}
    </div>
  );
}
