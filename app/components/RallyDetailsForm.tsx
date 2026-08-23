'use client';

import React, { useState } from 'react';

import {
  normalizeRallyCodeInput,
  RALLY_CODE_MAX_LENGTH,
  slugFromName,
} from '../lib/rallyCodes';

export interface RallyDetailsValue {
  name: string;
  code: string;
}

interface RallyDetailsFormProps {
  // Set to edit an existing rally; left out, the form creates one.
  rallyId?: string;
  initial?: Partial<RallyDetailsValue>;
  submitLabel?: string;
  onSaved: (rally: { _id: string } & RallyDetailsValue) => void;
  onCancel?: () => void;
}

// The name and the code of one rally. Used both to create a rally and to
// correct one, so the two paths cannot drift apart.
//
// The code is the rally's public identifier: a crew reads it off the printed
// sheet and the Android app shows it as the name of their card. Officials name
// it themselves — while a rally is being created the field follows the rally
// name, until they type in it, and from then on it is theirs.
const RallyDetailsForm: React.FC<RallyDetailsFormProps> = ({
  rallyId,
  initial,
  submitLabel = 'Save Rally',
  onSaved,
  onCancel,
}) => {
  const isEditing = rallyId !== undefined;

  const [name, setName] = useState<string>(initial?.name || '');
  const [code, setCode] = useState<string>(initial?.code || '');
  // Once the code has been typed in it stops following the name. An existing
  // rally's code is always its own — renaming a rally must not silently change
  // what the printed sheets say.
  const [codeIsOwn, setCodeIsOwn] = useState<boolean>(isEditing || Boolean(initial?.code));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!codeIsOwn) setCode(value.trim() ? slugFromName(value) : '');
  };

  const handleCodeChange = (value: string) => {
    setCodeIsOwn(true);
    setCode(normalizeRallyCodeInput(value));
  };

  const codeChanged = isEditing && code !== (initial?.code || '');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Enter a rally name.');
      return;
    }

    if (!code.trim()) {
      setError('Enter a rally code — the crews need it to read their card.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(isEditing ? `/api/rallies/${rallyId}` : '/api/rallies', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // A taken code comes back as a 409 with a message worth showing.
        throw new Error(data?.error || 'Failed to save the rally');
      }

      onSaved(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save the rally');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <label htmlFor="rallyName" className="block text-lg font-medium mb-2 text-gray-800">
        Rally Name
      </label>
      <input
        type="text"
        id="rallyName"
        className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg text-gray-800"
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        placeholder="e.g. SARK Najaarsrit 2026"
        maxLength={200}
        required
      />

      <label htmlFor="rallyCode" className="block text-lg font-medium mt-6 mb-2 text-gray-800">
        Rally Code
      </label>
      <input
        type="text"
        id="rallyCode"
        className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg font-mono tracking-wider text-gray-800"
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        placeholder="e.g. SARKNAJAAR"
        maxLength={RALLY_CODE_MAX_LENGTH}
        required
      />
      <p className="text-gray-600 text-base mt-2">
        The short name the crews see: it is printed under every QR code of this rally and is
        what the control-card app shows as the name of their card. Letters, digits and dashes.
        {!isEditing && ' Suggested from the rally name until you change it.'}
      </p>

      {codeChanged && (
        <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded text-base">
          <span className="font-semibold">Changing the code affects cards already in the
          crews&apos; phones.</span>{' '}
          A card that was scanned but not yet handed in was stored with the old code and will be
          refused when it is sent in; that crew has to scan their QR again. Cards already handed
          in, and QR codes not yet scanned, are unaffected.
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium text-lg transition duration-150 disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-lg shadow-md transition duration-150 disabled:opacity-60"
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
};

export default RallyDetailsForm;
