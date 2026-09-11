'use client';

import React, { useMemo, useState } from 'react';
import ClassificationBadge from './ClassificationBadge';
import PersonPicker from './PersonPicker';
import { crewClassification } from '../lib/participants';
import {
  EMPTY_VEHICLE,
  FUEL_TYPES,
  type PersonSummary,
  type Vehicle,
} from '../lib/persons';

export interface ParticipantDetailsValue {
  eq: number;
  driverId: string | null;
  navigatorId: string | null;
  vehicle: Vehicle;
}

interface ParticipantDetailsFormProps {
  rallyId: string;
  // Set for an EQ that is already fixed — correcting an existing entry, or
  // registering the crew of an EQ that only exists as answer sheets. The
  // number is then shown but not editable, and the save upserts on that EQ.
  // Left out, the form adds a new participant and the EQ is typed in.
  lockedEq?: number;
  initial?: Partial<ParticipantDetailsValue>;
  // Every registered rider, so both seats can be picked without this form
  // fetching the register once per row that is opened.
  people: PersonSummary[];
  // Riders already in another car in this rally, so a seat that would be
  // refused is greyed out rather than answered with a 409.
  takenIds?: Set<string>;
  submitLabel?: string;
  onSaved: (participant: ParticipantDetailsValue) => void;
  onCancel?: () => void;
}

// The crew riding under one EQ number, and the car they brought. Used both to
// add a participant to a rally and to correct one, so the two paths cannot
// drift apart.
//
// Three things this form deliberately does **not** ask for:
//
//   * **The crew's class.** It is the higher of the two riders' on B < A < H
//     and is derived server-side (`app/lib/crewRegistration.ts`). The preview
//     below shows what that comes to, using the same shared function, so an
//     official can see it before saving — but it is shown, never typed.
//   * **Names.** A crew is two registered riders, not two strings. The names
//     on the entry are copies of theirs.
//   * **Contact details.** Those belong to the rider, across every rally, and
//     are edited in the register.
//
// Both seats or neither: an entry with one rider named cannot be grouped into
// a crew's season, so the API refuses it and the form says so before it tries.
const ParticipantDetailsForm: React.FC<ParticipantDetailsFormProps> = ({
  rallyId,
  lockedEq,
  initial,
  people,
  takenIds,
  submitLabel = 'Save Participant',
  onSaved,
  onCancel,
}) => {
  const [eq, setEq] = useState<number | ''>(lockedEq ?? initial?.eq ?? '');
  const [driverId, setDriverId] = useState<string | null>(initial?.driverId ?? null);
  const [navigatorId, setNavigatorId] = useState<string | null>(initial?.navigatorId ?? null);
  const [vehicle, setVehicle] = useState<Vehicle>(initial?.vehicle ?? { ...EMPTY_VEHICLE });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(people.map((person) => [person._id, person])),
    [people]
  );

  const driver = driverId ? byId.get(driverId) ?? null : null;
  const navigator = navigatorId ? byId.get(navigatorId) ?? null : null;

  // What the crew's class will come out as. The same function the server
  // derives it with, so the preview cannot promise a class the entry will not
  // get.
  const crewClass =
    driver && navigator
      ? crewClassification(driver.classification, navigator.classification)
      : '';

  // The riders already in another car, minus the two on this entry: a crew
  // being corrected must not find its own riders greyed out.
  const unavailable = useMemo(() => {
    const taken = new Set(takenIds ?? []);
    if (initial?.driverId) taken.delete(initial.driverId);
    if (initial?.navigatorId) taken.delete(initial.navigatorId);
    return taken;
  }, [takenIds, initial?.driverId, initial?.navigatorId]);

  const setVehicleField = <K extends keyof Vehicle>(field: K, value: Vehicle[K]) =>
    setVehicle((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const participantEq = lockedEq ?? (eq === '' ? NaN : Number(eq));
    if (!Number.isInteger(participantEq) || participantEq < 1 || participantEq > 100) {
      setError('Enter an EQ number between 1 and 100.');
      return;
    }

    if (Boolean(driverId) !== Boolean(navigatorId)) {
      setError('A crew needs both a driver and a navigator, or neither yet.');
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
            driverId,
            navigatorId,
            vehicle,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save participant');
      }

      onSaved({ eq: participantEq, driverId, navigatorId, vehicle });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save participant.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof Omit<Vehicle, 'fuelType'>,
    placeholder: string,
    maxLength: number
  ) => (
    <div>
      <label
        htmlFor={`vehicle-${key}`}
        className="block text-sm font-semibold mb-1 text-gray-800"
      >
        {label}
      </label>
      <input
        type="text"
        id={`vehicle-${key}`}
        maxLength={maxLength}
        className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
        value={vehicle[key]}
        onChange={(e) => setVehicleField(key, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 rounded text-base font-medium">
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[8rem_1fr_1fr_10rem] gap-3 items-start">
        <div>
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

        <PersonPicker
          id="participant-driver"
          label="Driver"
          people={people}
          value={driverId}
          onChange={setDriverId}
          excludeId={navigatorId}
          takenIds={unavailable}
        />

        <PersonPicker
          id="participant-navigator"
          label="Navigator"
          people={people}
          value={navigatorId}
          onChange={setNavigatorId}
          excludeId={driverId}
          takenIds={unavailable}
        />

        <div>
          <span className="block text-sm font-semibold mb-1 text-gray-800">Crew class</span>
          <div className="flex items-center gap-2 p-2 h-[2.75rem]">
            <ClassificationBadge classification={crewClass} />
            <span className="text-sm text-gray-500">
              {driver && navigator ? 'highest of the two' : 'pick both riders'}
            </span>
          </div>
        </div>
      </div>

      {/* The car. On the entry rather than on a rider, because a crew turns up
          in whatever they have that weekend. None of it is required — an entry
          list arrives long before the cars do. */}
      <fieldset className="border border-gray-200 rounded-lg p-3">
        <legend className="px-2 text-sm font-semibold text-gray-800">Vehicle</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {field('Brand', 'brand', 'e.g. Toyota', 100)}
          {field('Model', 'model', 'e.g. Corolla', 100)}
          {field('Licence plate', 'licensePlate', 'e.g. PK-12-34', 32)}
          <div>
            <label
              htmlFor="vehicle-fuelType"
              className="block text-sm font-semibold mb-1 text-gray-800"
            >
              Fuel type
            </label>
            <select
              id="vehicle-fuelType"
              className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
              value={vehicle.fuelType}
              onChange={(e) =>
                setVehicleField('fuelType', e.target.value as Vehicle['fuelType'])
              }
            >
              <option value="">— unknown —</option>
              {FUEL_TYPES.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuel}
                </option>
              ))}
            </select>
          </div>
          {field('Insurance company', 'insurer', 'e.g. Assuria', 200)}
        </div>
      </fieldset>

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
    </form>
  );
};

export default ParticipantDetailsForm;
