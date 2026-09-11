'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import ClassificationBadge from './ClassificationBadge';
import { personMatches, type PersonSummary } from '../lib/persons';

interface PersonPickerProps {
  id: string;
  label: string;
  // Every registered rider, loaded once by the parent and shared between the
  // two pickers of a crew — the register is one request, not one per seat.
  people: PersonSummary[];
  value: string | null;
  onChange: (personId: string | null) => void;
  // The other seat of this crew. Shown greyed out, because a rider cannot
  // drive and navigate the same car.
  excludeId?: string | null;
  // Riders already entered in this rally under another EQ. A rider is in one
  // car per rally, so picking one of these would be refused by the API — the
  // picker says so first.
  takenIds?: Set<string>;
  disabled?: boolean;
}

// One seat of a crew: which registered rider is in it.
//
// A typed search over the register rather than a `<select>` of two hundred
// names, and it searches the **e-mail address** as well as the name, because
// the address is the rider's identity and is how two people with one name are
// told apart (app/lib/persons.ts).
//
// It never creates a rider. Registering somebody is the register's job, where
// it carries their contact details and their class; a picker that quietly
// added a half-filled person would put unreachable entries in the entry list.
const PersonPicker: React.FC<PersonPickerProps> = ({
  id,
  label,
  people,
  value,
  onChange,
  excludeId = null,
  takenIds,
  disabled = false,
}) => {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => people.find((person) => person._id === value) ?? null,
    [people, value]
  );

  // Clicking anywhere else closes the list. Without this the list of the seat
  // an official just left stays open over the one they moved to.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // The whole register is in memory, so this filters rather than fetches. Cut
  // at 25: a search that matches half the club is a search that has not been
  // typed far enough yet, and rendering it all makes the list unusable.
  const matches = useMemo(
    () =>
      people
        .filter((person) => person._id !== excludeId && personMatches(person, search))
        .slice(0, 25),
    [people, excludeId, search]
  );

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="block text-sm font-semibold mb-1 text-gray-800">
        {label}
      </label>

      {selected ? (
        <div className="flex items-center gap-2 w-full p-2 border-2 border-gray-300 rounded-lg bg-white">
          <ClassificationBadge classification={selected.classification} />
          <span className="flex-1 min-w-0">
            <span className="block text-base text-gray-900 truncate">{selected.name}</span>
            <span className="block text-sm text-gray-500 truncate">{selected.email}</span>
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setSearch('');
                setOpen(true);
              }}
              className="text-sm font-medium text-red-600 hover:text-red-800 px-2"
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <input
          type="text"
          id={id}
          autoComplete="off"
          disabled={disabled}
          className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700 disabled:bg-gray-100"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or e-mail"
        />
      )}

      {open && !selected && !disabled && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border-2 border-gray-200 rounded-lg shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-base text-gray-500">
              No rider matches. Add them in the rider register first.
            </li>
          ) : (
            matches.map((person) => {
              const taken = takenIds?.has(person._id) ?? false;

              return (
                <li key={person._id}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => {
                      onChange(person._id);
                      setSearch('');
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 disabled:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <ClassificationBadge classification={person.classification} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-base text-gray-900 truncate">
                        {person.name}
                      </span>
                      <span className="block text-sm text-gray-500 truncate">
                        {person.email}
                      </span>
                    </span>
                    {taken && (
                      <span className="text-sm text-amber-700 whitespace-nowrap">
                        already entered
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};

export default PersonPicker;
