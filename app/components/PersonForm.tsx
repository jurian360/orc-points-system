'use client';

import React, { useState } from 'react';
import {
  EMAIL_RULE,
  isValidEmail,
  isValidPhone,
  MAX_EMAIL_LENGTH,
  MAX_FOOD_RESTRICTIONS_LENGTH,
  MAX_PHONE_LENGTH,
  normalizeEmail,
  PHONE_RULE,
  type Person,
} from '../lib/persons';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../lib/roles';

interface PersonFormProps {
  // Set to correct an existing rider; left out, the form registers a new one.
  person?: Person;
  onSaved: (person: Person) => void;
  onCancel: () => void;
}

// One rider's details: who they are, how to reach them, what they cannot eat,
// and whether they can sign in.
//
// Their **classification is not here**. It is set on the rider's own page,
// through a route a classification admin may call, and every change is dated
// and attributed — so it is not a field that can be swept along by a save of
// somebody's phone number.
//
// Changing the e-mail address is an ordinary edit: the address is the rider's
// identity and lives on this one document, so every entry, crew and result
// follows it. The warning below says so, because officials expect changing an
// identity to be dangerous.
const PersonForm: React.FC<PersonFormProps> = ({ person, onSaved, onCancel }) => {
  const isEditing = person !== undefined;

  const [email, setEmail] = useState(person?.email ?? '');
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [foodRestrictions, setFoodRestrictions] = useState(person?.foodRestrictions ?? '');
  const [password, setPassword] = useState('');
  // Only meaningful while editing: clearing the login of a rider who has one.
  const [removeLogin, setRemoveLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailChanged = isEditing && normalizeEmail(email) !== person.email;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const address = normalizeEmail(email);
    if (!isValidEmail(address)) {
      setError(EMAIL_RULE);
      return;
    }

    if (!name.trim()) {
      setError('Enter the member’s name.');
      return;
    }

    if (phone.trim() && !isValidPhone(phone)) {
      setError(PHONE_RULE);
      return;
    }

    if (password && password.length < MIN_PASSWORD_LENGTH) {
      setError(PASSWORD_RULE);
      return;
    }

    // Only the fields that changed are sent, so saving a phone number cannot
    // touch a login. `null` is the one value that means something on its own:
    // take this rider's login away.
    const body: Record<string, unknown> = {
      email: address,
      name: name.trim(),
      phone: phone.trim(),
      foodRestrictions: foodRestrictions.trim(),
    };

    if (removeLogin) body.password = null;
    else if (password) body.password = password;

    setSaving(true);
    try {
      const response = await fetch(isEditing ? `/api/persons/${person._id}` : '/api/persons', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save this member');

      onSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this member.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 rounded text-base font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="person-email" className="block text-sm font-semibold mb-1 text-gray-800">
            E-mail address
          </label>
          <input
            type="email"
            id="person-email"
            maxLength={MAX_EMAIL_LENGTH}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jan@example.com"
            required
          />
          <p className="text-gray-600 text-sm mt-1">
            How this member is identified, and what they sign in with.
          </p>
        </div>

        <div>
          <label htmlFor="person-name" className="block text-sm font-semibold mb-1 text-gray-800">
            Full name
          </label>
          <input
            type="text"
            id="person-name"
            maxLength={200}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jan Jansen"
            required
          />
          <p className="text-gray-600 text-sm mt-1">
            Printed on the entry list and the result sheets.
          </p>
        </div>

        <div>
          <label htmlFor="person-phone" className="block text-sm font-semibold mb-1 text-gray-800">
            Phone number
          </label>
          <input
            type="tel"
            id="person-phone"
            maxLength={MAX_PHONE_LENGTH}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+597 000 0000"
          />
        </div>

        <div>
          <label
            htmlFor="person-password"
            className="block text-sm font-semibold mb-1 text-gray-800"
          >
            {person?.hasLogin ? 'Reset password' : 'Give a login'}
          </label>
          <input
            type="password"
            id="person-password"
            autoComplete="new-password"
            disabled={removeLogin}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700 disabled:bg-gray-100"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={person?.hasLogin ? 'Leave empty to keep it' : 'Optional'}
          />
          <p className="text-gray-600 text-sm mt-1">
            A member without one is still entered, scored and placed — they just cannot look at
            it themselves. {PASSWORD_RULE}
          </p>
          {person?.hasLogin && (
            <label className="flex items-center gap-2 mt-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={removeLogin}
                onChange={(e) => {
                  setRemoveLogin(e.target.checked);
                  if (e.target.checked) setPassword('');
                }}
              />
              Remove this member’s login
            </label>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="person-food" className="block text-sm font-semibold mb-1 text-gray-800">
          Food restrictions
        </label>
        <textarea
          id="person-food"
          rows={2}
          maxLength={MAX_FOOD_RESTRICTIONS_LENGTH}
          className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
          value={foodRestrictions}
          onChange={(e) => setFoodRestrictions(e.target.value)}
          placeholder="e.g. vegetarian, no shellfish"
        />
      </div>

      {emailChanged && (
        <div className="bg-blue-50 border border-blue-300 text-blue-900 px-4 py-3 rounded text-base">
          <span className="font-semibold">Changing the address moves the whole record.</span>{' '}
          The address is what identifies this member, and it is stored here only — every entry,
          crew and result they have follows it automatically. They sign in with the new address
          from now on.
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base shadow-sm disabled:opacity-60"
        >
          {saving ? 'Saving…' : isEditing ? 'Save member' : 'Add member'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default PersonForm;
