'use client';

import React, { useState } from 'react';
import { CLASSIFICATIONS, type ClassificationValue } from '../lib/participants';

export interface ParticipantDetailsValue {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface ParticipantDetailsFormProps {
  rallyId: string;
  // Set for an EQ that is already fixed — correcting an existing participant, or
  // naming the crew of a participant that only exists as answer sheets. The
  // number is then shown but not editable, and the save upserts on that EQ.
  // Left out, the form adds a new participant and the EQ is typed in.
  lockedEq?: number;
  initial?: Partial<ParticipantDetailsValue>;
  submitLabel?: string;
  onSaved: (participant: ParticipantDetailsValue) => void;
  onCancel?: () => void;
}

// The class and the crew of one participant. Used both to add a participant to a
// rally and to correct one, so the two paths cannot drift apart.
//
// The names are optional: officials often have the EQ and the class of a crew
// before the entry list reaches them.
const ParticipantDetailsForm: React.FC<ParticipantDetailsFormProps> = ({
  rallyId,
  lockedEq,
  initial,
  submitLabel = 'Save Participant',
  onSaved,
  onCancel,
}) => {
  const [eq, setEq] = useState<number | ''>(lockedEq ?? initial?.eq ?? '');
  const [classification, setClassification] = useState<ClassificationValue>(
    initial?.classification || ''
  );
  const [driverName, setDriverName] = useState<string>(initial?.driverName || '');
  const [navigatorName, setNavigatorName] = useState<string>(initial?.navigatorName || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const participantEq = lockedEq ?? (eq === '' ? NaN : Number(eq));
    if (!Number.isInteger(participantEq) || participantEq < 1 || participantEq > 100) {
      setError('Enter an EQ number between 1 and 100.');
      return;
    }

    setSaving(true);
    try {
      // A fixed EQ upserts on that participant; a new one is created, so an EQ
      // that is already taken comes back as a 409 instead of overwriting the
      // crew that holds it.
      const response = await fetch(
        lockedEq === undefined
          ? `/api/rallies/${rallyId}/participants`
          : `/api/rallies/${rallyId}/participants/${lockedEq}`,
        {
          method: lockedEq === undefined ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eq: participantEq,
            classification,
            driverName,
            navigatorName,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save participant');
      }

      onSaved({
        eq: participantEq,
        classification,
        driverName: driverName.trim(),
        navigatorName: navigatorName.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save participant.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 rounded mb-3 text-base font-medium">
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="lg:w-32">
          <label
            htmlFor="participant-eq"
            className="block text-sm font-semibold mb-1 text-gray-800"
          >
            EQ. No.
          </label>
          <input
            type="number"
            id="participant-eq"
            min={1}
            max={100}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700 disabled:bg-gray-100"
            value={eq}
            onChange={(e) => setEq(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={lockedEq !== undefined}
            placeholder="1-100"
            required
          />
        </div>

        <div className="lg:w-40">
          <label
            htmlFor="participant-classification"
            className="block text-sm font-semibold mb-1 text-gray-800"
          >
            Classification
          </label>
          <select
            id="participant-classification"
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={classification}
            onChange={(e) => setClassification(e.target.value as ClassificationValue)}
          >
            <option value="">— none —</option>
            {CLASSIFICATIONS.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label
            htmlFor="participant-driver"
            className="block text-sm font-semibold mb-1 text-gray-800"
          >
            Driver — full name
          </label>
          <input
            type="text"
            id="participant-driver"
            maxLength={200}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder="Full name of the driver"
          />
        </div>

        <div className="flex-1">
          <label
            htmlFor="participant-navigator"
            className="block text-sm font-semibold mb-1 text-gray-800"
          >
            Navigator — full name
          </label>
          <input
            type="text"
            id="participant-navigator"
            maxLength={200}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={navigatorName}
            onChange={(e) => setNavigatorName(e.target.value)}
            placeholder="Full name of the navigator"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-5 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
};

export default ParticipantDetailsForm;
