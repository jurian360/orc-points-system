'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ClassificationBadge from '../../components/ClassificationBadge';
import ParticipantsPanel from '../../components/ParticipantsPanel';
import { crewLabel, type ClassificationValue } from '../../lib/participants';

interface Rally {
  _id: string;
  name: string;
  createdAt: string;
}

interface Stage {
  _id: string;
  name: string;
  createdAt: string;
}

interface StandingsEntry {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  timePenalty: number;
  sheetsSubmitted: number;
  disqualified: boolean;
  rank: number;
}

export default function RallyDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [totalStages, setTotalStages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  // `showLoading` is off for the refresh after a participant change: the page
  // is already on screen and should not blink back to the loading state.
  const loadData = useCallback(async (showLoading = true) => {
    if (!rallyId) return;
    try {
      if (showLoading) setLoading(true);
      const [rallyRes, stagesRes, standingsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/standings`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      if (stagesRes.ok) setStages(await stagesRes.json());

      if (standingsRes.ok) {
        const data = await standingsRes.json();
        setStandings(data.standings || []);
        setTotalStages(data.totalStages || 0);
      }
    } catch (err) {
      setError('Failed to load rally. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteStage = async (stageId: string) => {
    if (
      !window.confirm(
        'Delete this stage? All answer sheets submitted for it will also be deleted. This cannot be undone.'
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/stages/${stageId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete stage');
      loadData();
    } catch (err) {
      alert('Failed to delete stage. Please try again.');
      console.error(err);
    }
  };

  // Removing a participant from the rally deletes their details and every
  // answer sheet they have in it.
  const handleDeleteParticipant = async (eq: number) => {
    if (
      !window.confirm(
        `Delete participant ${eq} from this rally? Their details and every answer sheet they submitted for it will be deleted. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/${eq}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete participant');
      loadData(false);
    } catch (err) {
      alert('Failed to delete participant. Please try again.');
      console.error(err);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading rally...</p>
      </div>
    );
  }

  if (error || !rally) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg">
            Back to Rallies
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{rally.name}</h1>
            <p className="text-gray-600 mt-1 text-base">Created: {formatDate(rally.createdAt)}</p>
          </div>
          <Link
            href={`/rallies/${rally._id}/answer-sheets`}
            className="px-5 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 text-lg font-medium shadow-md transition duration-150 text-center"
          >
            Enter Answer Sheets
          </Link>
        </div>

        {/* Stages */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-gray-800">Stages</h2>
            <Link
              href={`/rallies/${rally._id}/stages/new`}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm"
            >
              Add Stage
            </Link>
          </div>
          {stages.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600 mb-4">
                No stages yet. Add the first stage and its answer key.
              </p>
              <Link
                href={`/rallies/${rally._id}/stages/new`}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 inline-block"
              >
                Add Stage
              </Link>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Stage
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stages.map((stage) => (
                  <tr key={stage._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-lg font-medium text-gray-900">{stage.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-base text-gray-600">{formatDate(stage.createdAt)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex justify-end space-x-4">
                        <Link
                          href={`/rallies/${rally._id}/stages/${stage._id}`}
                          className="text-blue-600 hover:text-blue-900 font-medium text-base"
                        >
                          View
                        </Link>
                        <Link
                          href={`/rallies/${rally._id}/stages/${stage._id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDeleteStage(stage._id)}
                          className="text-red-600 hover:text-red-900 font-medium text-base"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Participants */}
        <ParticipantsPanel
          rallyId={rally._id}
          sheetEqs={standings.map((entry) => entry.eq)}
          onChanged={() => loadData(false)}
        />

        {/* Standings */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-2xl font-semibold text-gray-800">Standings</h2>
            <p className="text-gray-600 text-base mt-1">
              Ranked by total penalty points (ORC&apos;s + Tijd) across all answer sheets — lowest
              wins. A disqualified participant is ranked behind everyone still in the rally.
            </p>
          </div>
          {standings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600">
                No answer sheets submitted yet. Standings will appear once participants have sheets.
              </p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Participant (EQ)
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Class
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Driver / Navigator
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Sheets
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Tijd
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Total Penalty
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {standings.map((entry) => (
                  <tr
                    key={entry.eq}
                    className={
                      entry.disqualified
                        ? 'bg-red-50'
                        : entry.rank === 1
                          ? 'bg-yellow-50'
                          : 'hover:bg-gray-50'
                    }
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-lg font-bold text-gray-900">
                        {entry.rank}
                        {entry.rank === 1 && !entry.disqualified && (
                          <span className="ml-2" title="Winner">🏆</span>
                        )}
                        {entry.disqualified && (
                          <span
                            className="ml-2 px-2 py-0.5 rounded bg-red-100 text-red-800 text-sm font-bold"
                            title="Outside the finish window of the last stage"
                          >
                            DQ
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        href={`/rallies/${rally._id}/participants/${entry.eq}`}
                        className="text-lg font-medium text-blue-600 hover:underline"
                      >
                        {entry.eq}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ClassificationBadge classification={entry.classification} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-base text-gray-800">
                        {crewLabel(entry) || <span className="text-gray-400">—</span>}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-base text-gray-600">
                        {entry.sheetsSubmitted}
                        {totalStages > 0 ? ` / ${totalStages}` : ''}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-base text-gray-600">{entry.timePenalty}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className="text-lg font-bold text-red-600">{entry.totalPenalty}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex justify-end space-x-4">
                        <Link
                          href={`/rallies/${rally._id}/participants/${entry.eq}`}
                          className="text-blue-600 hover:text-blue-900 font-medium text-base"
                        >
                          View Answers
                        </Link>
                        <button
                          onClick={() => handleDeleteParticipant(entry.eq)}
                          className="text-red-600 hover:text-red-900 font-medium text-base"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-8">
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg font-medium">
            &larr; Back to Rallies
          </Link>
        </div>
      </div>
    </div>
  );
}
