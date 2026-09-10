'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import ParticipantDetailsForm from './ParticipantDetailsForm';
import ParticipantImportPanel from './ParticipantImportPanel';
import { CLASSIFICATION_LIST, type ClassificationValue } from '../lib/participants';

interface Participant {
  _id: string;
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface ParticipantsPanelProps {
  rallyId: string;
  // The EQ numbers that have answer sheets in this rally. They are listed
  // alongside the recorded participants so a crew that was typed straight onto a
  // card can still be given a class and names.
  sheetEqs: number[];
  // Called after a change that the rest of the page shows too (the standings
  // carry the class and the crew names, and a delete removes answer sheets).
  onChanged?: () => void;
  // How many crews are recorded, so the page can label its Participants tab
  // without fetching the entry list a second time.
  onCountChange?: (count: number) => void;
  // Set for an official who may not change the entry list — a data-entry
  // account. The list itself stays: they need to see which crew rides under
  // which EQ while they type the cards.
  readOnly?: boolean;
}

type Editing = { mode: 'add' } | { mode: 'edit'; eq: number } | null;

// The participants of a rally: which EQ number is which crew, and in which
// class they ride. None of it touches the scoring — a participant is still
// their answer sheets — it is the entry list beside those sheets.
const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  rallyId,
  sheetEqs,
  onChanged,
  onCountChange,
  readOnly = false,
}) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Held in a ref so an inline callback from the page cannot re-create
  // `loadParticipants` on every render and fetch in a loop.
  const countChangeRef = useRef(onCountChange);
  countChangeRef.current = onCountChange;

  const loadParticipants = useCallback(async () => {
    if (!rallyId) return;
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants`);
      if (!response.ok) throw new Error('Failed to fetch participants');
      const data: Participant[] = await response.json();
      setParticipants(data);
      countChangeRef.current?.(data.length);
      setError(null);
    } catch (err) {
      setError('Failed to load the participants of this rally.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadParticipants();
  }, [loadParticipants]);

  // One row per EQ that is part of the rally, whether that is because somebody
  // recorded the crew or because a card was entered for it.
  const rows = useMemo(() => {
    const byEq = new Map<number, { eq: number; details?: Participant; hasSheets: boolean }>();

    for (const participant of participants) {
      byEq.set(participant.eq, { eq: participant.eq, details: participant, hasSheets: false });
    }
    for (const eq of sheetEqs) {
      const existing = byEq.get(eq);
      if (existing) existing.hasSheets = true;
      else byEq.set(eq, { eq, hasSheets: true });
    }

    return Array.from(byEq.values()).sort((a, b) => a.eq - b.eq);
  }, [participants, sheetEqs]);

  // An entry list runs to 50+ crews: searching it by number or by name is how
  // an official finds the one row they came for.
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(({ eq, details }) => {
      if (String(eq).startsWith(term)) return true;
      const crew = `${details?.driverName ?? ''} ${details?.navigatorName ?? ''}`.toLowerCase();
      return crew.includes(term);
    });
  }, [rows, search]);

  const handleSaved = async () => {
    setEditing(null);
    await loadParticipants();
    onChanged?.();
  };

  const handleImported = async (summary: {
    total: number;
    created: number;
    updated: number;
  }) => {
    setImporting(false);
    setNotice(
      `Imported ${summary.total} participant${summary.total === 1 ? '' : 's'} — ` +
        `${summary.created} added, ${summary.updated} updated.`
    );
    await loadParticipants();
    onChanged?.();
  };

  // Same meaning as everywhere else in the app: removing a participant from the
  // rally takes their answer sheets with them.
  const handleDelete = async (eq: number, hasSheets: boolean) => {
    if (
      !window.confirm(
        hasSheets
          ? `Delete participant ${eq} from this rally? Their details and every answer sheet they submitted for it will be deleted. This cannot be undone.`
          : `Delete participant ${eq} from this rally? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/${eq}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete participant');
      setError(null);
      if (editing && editing.mode === 'edit' && editing.eq === eq) setEditing(null);
      await loadParticipants();
      onChanged?.();
    } catch (err) {
      setError('Failed to delete this participant. Please try again.');
      console.error(err);
    }
  };

  const editingRow =
    editing && editing.mode === 'edit'
      ? rows.find((row) => row.eq === editing.eq)
      : undefined;

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Participants</h2>
          <p className="text-gray-600 text-sm mt-1">
            Who rides under which EQ number: their classification ({CLASSIFICATION_LIST}) and the full
            names of the driver and the navigator.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search EQ or crew"
            aria-label="Search the participants"
            className="px-3 py-2 border border-gray-300 rounded-md text-base w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!readOnly && (
            <>
              <button
                onClick={() => {
                  setNotice(null);
                  setImporting((current) => !current);
                  setEditing(null);
                }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium shadow-sm"
              >
                {importing ? 'Close Import' : 'Import Entry List'}
              </button>
              <button
                onClick={() => {
                  setNotice(null);
                  setEditing(editing?.mode === 'add' ? null : { mode: 'add' });
                  setImporting(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm"
              >
                {editing?.mode === 'add' ? 'Close' : 'Add Participant'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 text-base font-medium">
          <p>{error}</p>
        </div>
      )}

      {notice && (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-6 py-3 text-base font-medium">
          <p>{notice}</p>
        </div>
      )}

      {importing && (
        <ParticipantImportPanel
          rallyId={rallyId}
          existingEqs={participants.map((participant) => participant.eq)}
          onImported={handleImported}
          onCancel={() => setImporting(false)}
        />
      )}

      {editing && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-800 mb-3">
            {editing.mode === 'add' ? 'Add a participant' : `Participant ${editing.eq}`}
          </h3>
          <ParticipantDetailsForm
            // Remounted per participant so the fields reload when another row is
            // opened for editing.
            key={editing.mode === 'add' ? 'add' : `edit-${editing.eq}`}
            rallyId={rallyId}
            lockedEq={editing.mode === 'edit' ? editing.eq : undefined}
            initial={editingRow?.details}
            submitLabel={editing.mode === 'add' ? 'Add Participant' : 'Save Participant'}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center">
          <p className="text-lg text-gray-600">Loading participants...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-lg text-gray-600">
            No participants yet. Import the entry list of this rally, add the crews by hand, or
            enter an answer sheet — an EQ that has a sheet shows up here too.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-lg text-gray-600">No participant matches this search.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  EQ
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Class
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Driver
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Navigator
                </th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visibleRows.map(({ eq, details, hasSheets }) => (
                <tr key={eq} className="hover:bg-gray-50">
                  <td className="px-6 py-2 whitespace-nowrap">
                    <Link
                      href={`/rallies/${rallyId}/participants/${eq}`}
                      className="text-base font-bold text-blue-600 hover:underline"
                    >
                      {eq}
                    </Link>
                    {!hasSheets && (
                      <span className="ml-2 text-sm text-gray-500">no sheets yet</span>
                    )}
                  </td>
                  <td className="px-6 py-2 whitespace-nowrap">
                    <ClassificationBadge classification={details?.classification} />
                  </td>
                  <td className="px-6 py-2">
                    <span className="text-base text-gray-800">
                      {details?.driverName || <span className="text-gray-400">—</span>}
                    </span>
                  </td>
                  <td className="px-6 py-2">
                    <span className="text-base text-gray-800">
                      {details?.navigatorName || <span className="text-gray-400">—</span>}
                    </span>
                  </td>
                  <td className="px-6 py-2 whitespace-nowrap text-right">
                    <div className="flex justify-end space-x-4">
                      {readOnly ? (
                        <span className="text-gray-400 text-base">—</span>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditing({ mode: 'edit', eq })}
                            className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                          >
                            {details ? 'Edit' : 'Add Details'}
                          </button>
                          <button
                            onClick={() => handleDelete(eq, hasSheets)}
                            className="text-red-600 hover:text-red-900 font-medium text-base"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ParticipantsPanel;
