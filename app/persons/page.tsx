'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from '../components/ClassificationBadge';
import PersonForm from '../components/PersonForm';
import { useAuth } from '../components/AuthContext';
import { PAGE_CONTAINER } from '../lib/layout';
import { personMatches, type Person } from '../lib/persons';
import { CLASSIFICATIONS } from '../lib/participants';

// The rider register: every human being who rides these rallies, across every
// event and every season.
//
// It is a read page for **any** official — a crew is picked out of this list,
// so a data-entry official looking at an entry list is looking at these people
// — with its buttons gated per permission. That is the same arrangement the
// rally dashboard has, and it is why `middleware.ts` does not restrict this
// page: hiding a button is a courtesy, and every route behind it is guarded.
//
// A classification admin's whole job is here: they cannot add or delete a
// rider, and the class dropdown on each row is the one control they can use.
export default function PersonsPage() {
  const { can } = useAuth();
  const mayManage = can('manage:persons');
  const mayClassify = can('manage:classifications');

  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('');
  // The row whose class is being saved, so two clicks cannot race.
  const [savingClass, setSavingClass] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/persons');
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not load the riders.');
        return;
      }

      setPeople(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load the riders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return people.filter((person) => {
      if (classFilter === '_none' && person.classification !== '') return false;
      if (classFilter && classFilter !== '_none' && person.classification !== classFilter) {
        return false;
      }
      return personMatches(
        {
          _id: person._id,
          email: person.email,
          name: person.name,
          classification: person.classification,
        },
        search
      );
    });
  }, [people, search, classFilter]);

  // Setting a class goes through its own route, which appends a dated entry to
  // the rider's history. A save that does not change anything writes nothing,
  // so re-picking the same letter is free.
  const handleClassification = async (person: Person, classification: string) => {
    setError(null);
    setNotice(null);
    setSavingClass(person._id);

    try {
      const response = await fetch(`/api/persons/${person._id}/classification`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not change the classification');

      setPeople((current) =>
        current.map((entry) => (entry._id === person._id ? data : entry))
      );
      setNotice(
        `${person.name} is now ${classification || 'without a classification'}. ` +
          'The change is dated in their history.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the classification.');
    } finally {
      setSavingClass(null);
    }
  };

  const handleDelete = async (person: Person) => {
    if (!confirm(`Delete ${person.name} (${person.email}) from the register?`)) return;

    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/persons/${person._id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      // A rider who has ridden cannot be deleted — the 409 explains why, and
      // it is worth showing rather than swallowing.
      if (!response.ok) throw new Error(data.error || 'Could not delete this rider');

      setPeople((current) => current.filter((entry) => entry._id !== person._id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this rider.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className={PAGE_CONTAINER}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Riders</h1>
            <p className="text-gray-600 text-base mt-1 max-w-3xl">
              Everybody who rides these rallies. A rider is identified by their e-mail address,
              and the class here is <em>theirs</em> — a crew&apos;s class is the higher of its
              two riders&apos; (B &lt; A &lt; H) and is worked out per entry.
            </p>
          </div>
          {mayManage && !adding && editingId === null && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
            >
              Add rider
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-base text-red-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-base text-green-800">
            {notice}
          </div>
        )}

        {adding && (
          <div className="bg-white rounded-xl shadow border border-gray-100 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add a rider</h2>
            <PersonForm
              onSaved={(saved) => {
                setPeople((current) =>
                  [...current, saved].sort((a, b) => a.name.localeCompare(b.name))
                );
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or e-mail"
            aria-label="Search the riders"
            className="px-3 py-2 border border-gray-300 rounded-md text-base w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            aria-label="Filter by classification"
            className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All classes</option>
            {CLASSIFICATIONS.map((letter) => (
              <option key={letter} value={letter}>
                Class {letter}
              </option>
            ))}
            <option value="_none">No class yet</option>
          </select>
          <span className="self-center text-base text-gray-600">
            {visible.length} of {people.length} riders
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-lg text-gray-600">Loading riders…</p>
          ) : people.length === 0 ? (
            <p className="p-8 text-center text-lg text-gray-600">
              No riders yet. Add them here, or import an entry list that carries an e-mail
              address per seat — that registers the crews as it goes.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-lg text-gray-600">No rider matches.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Rider
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Class
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Login
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {visible.map((person) =>
                    editingId === person._id ? (
                      <tr key={person._id}>
                        <td colSpan={5} className="px-6 py-4 bg-gray-50">
                          <PersonForm
                            person={person}
                            onSaved={(saved) => {
                              setPeople((current) =>
                                current.map((entry) =>
                                  entry._id === saved._id ? saved : entry
                                )
                              );
                              setEditingId(null);
                            }}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={person._id} className="hover:bg-gray-50">
                        <td className="px-6 py-2">
                          <Link
                            href={`/persons/${person._id}`}
                            className="text-base font-semibold text-blue-600 hover:underline"
                          >
                            {person.name}
                          </Link>
                          <span className="block text-sm text-gray-500">{person.email}</span>
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap">
                          {mayClassify ? (
                            <select
                              value={person.classification}
                              disabled={savingClass === person._id}
                              onChange={(e) => handleClassification(person, e.target.value)}
                              aria-label={`Classification of ${person.name}`}
                              className="p-1.5 border-2 border-gray-300 rounded-md text-base text-gray-700 disabled:opacity-60"
                            >
                              <option value="">— none —</option>
                              {CLASSIFICATIONS.map((letter) => (
                                <option key={letter} value={letter}>
                                  {letter}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <ClassificationBadge classification={person.classification} />
                          )}
                        </td>
                        <td className="px-6 py-2 text-base text-gray-700">
                          {person.phone || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-6 py-2 text-base">
                          {person.hasLogin ? (
                            <span className="text-green-700">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-right">
                          <div className="flex justify-end gap-4">
                            <Link
                              href={`/persons/${person._id}`}
                              className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                            >
                              Results
                            </Link>
                            {mayManage && (
                              <>
                                <button
                                  onClick={() => {
                                    setAdding(false);
                                    setEditingId(person._id);
                                  }}
                                  className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(person)}
                                  className="text-red-600 hover:text-red-900 font-medium text-base"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
