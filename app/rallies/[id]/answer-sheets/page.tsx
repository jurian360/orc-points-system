'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AnswerSheetForm from '../../../components/AnswerSheetForm';
import ClassificationBadge from '../../../components/ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../../../lib/participants';
import type { ScoreKeyRow } from '../../../lib/scoring';
import { PAGE_CONTAINER } from '../../../lib/pageContainer';

interface Rally {
  _id: string;
  name: string;
}

interface Stage {
  _id: string;
  name: string;
  // The full ORC key: the entry grid scores every row against it while the card
  // is typed — the strafpunten are computed, not entered — and marks the rows
  // whose letters are scored on their order too.
  scoreKey?: ScoreKeyRow[];
  timeScoreKey?: { rowNumber: number; ipt?: string }[];
  // The merk key: the entry form scores the merk column live against it.
  merkScoreKey?: { rowNumber: number; merk?: string; maxPenalty?: number }[];
  timeConfig?: Record<string, number>;
  // Whether this stage's ORC rows run 1-60 and its merk rows 1-12 instead of
  // 1-30/1-6 — AnswerSheetForm sizes its grids from this.
  usesSecondCard?: boolean;
}

interface Participant {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

// The sheets the rally already holds. They are not listed on this page — the
// standings, the stage view and the per-participant view are where a submitted
// card is read — but the entry form needs them: it greys out the crews that
// already have a sheet for the chosen stage and it chains the delta of the
// earlier stages into its live time preview.
interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  timePenalties?: { rowNumber: number; wpt?: string }[];
}

export default function AnswerSheetsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sheets, setSheets] = useState<AnswerSheet[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // The wizard: pick a stage (skipped when there is only one), then pick the
  // EQ whose card is being typed, then the card itself.
  const [stageId, setStageId] = useState<string>('');
  const [eq, setEq] = useState<number | null>(null);
  const [eqSearch, setEqSearch] = useState('');

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  const loadData = useCallback(async () => {
    if (!rallyId) return;
    try {
      setLoading(true);
      const [rallyRes, stagesRes, sheetsRes, participantsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/answersheets?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/participants`),
      ]);

      if (rallyRes.ok) setRally(await rallyRes.json());

      // The entry list the entry form picks from — a card can only be typed
      // for a crew the rally knows.
      if (participantsRes.ok) setParticipants(await participantsRes.json());

      if (stagesRes.ok) setStages(await stagesRes.json());

      if (sheetsRes.ok) setSheets(await sheetsRes.json());
    } catch (err) {
      setError('Failed to load data. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The stage step only exists to choose between two or more stages — with
  // just one, there is nothing to pick.
  useEffect(() => {
    if (!stageId && stages.length === 1) setStageId(stages[0]._id);
  }, [stages, stageId]);

  const stage = useMemo(() => stages.find((candidate) => candidate._id === stageId) || null, [
    stages,
    stageId,
  ]);

  // The sheets already entered for the stage being typed, by EQ — so the
  // participant step can send an already-entered EQ straight to editing
  // instead of listing it as available.
  const sheetsByEq = useMemo(() => {
    const map = new Map<number, AnswerSheet>();
    sheets.filter((sheet) => sheet.stageId === stageId).forEach((sheet) => map.set(sheet.eq, sheet));
    return map;
  }, [sheets, stageId]);

  // The entry list, plus any EQ that already has a sheet for this stage but
  // predates the entry list — that card still has to be reachable to correct
  // it, exactly as the old single-select did.
  const eqRows = useMemo(() => {
    const byEq = new Map<number, Participant | undefined>();
    participants.forEach((participant) => byEq.set(participant.eq, participant));
    sheetsByEq.forEach((_sheet, eqNumber) => {
      if (!byEq.has(eqNumber)) byEq.set(eqNumber, undefined);
    });
    return Array.from(byEq.entries())
      .map(([eqNumber, participant]) => ({
        eq: eqNumber,
        participant,
        sheet: sheetsByEq.get(eqNumber),
      }))
      .sort((a, b) => a.eq - b.eq);
  }, [participants, sheetsByEq]);

  const visibleEqRows = useMemo(() => {
    const term = eqSearch.trim().toLowerCase();
    if (!term) return eqRows;
    return eqRows.filter(
      (row) =>
        String(row.eq).startsWith(term) ||
        (row.participant ? crewLabel(row.participant).toLowerCase().includes(term) : false)
    );
  }, [eqRows, eqSearch]);

  const handleSubmit = async (answerSheet: any) => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/answersheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answerSheet),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit answer sheet');
      }

      setSuccess(`Answer sheet for EQ ${answerSheet.eq} submitted successfully!`);
      // Back to the participant step — a stage's cards are usually typed one
      // after another, so the next crew should be one click away.
      setEq(null);
      setEqSearch('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit answer sheet. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const needsStageStep = stages.length > 1;
  const stageChosen = Boolean(stageId);

  const backToStageStep = () => {
    setStageId('');
    setEq(null);
    setEqSearch('');
    setSuccess(null);
  };

  const backToEqStep = () => {
    setEq(null);
    setSuccess(null);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className={PAGE_CONTAINER}>
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Answer Sheets{rally ? ` — ${rally.name}` : ''}
          </h1>
          <p className="text-gray-700 text-base">
            {needsStageStep
              ? 'Pick the stage, then the EQ number, to type or correct a control card.'
              : 'Pick the EQ number to type or correct a control card.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{success}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-gray-800">
              {!stageChosen
                ? '1. Select Stage'
                : eq === null
                  ? `${needsStageStep ? '2' : '1'}. Select Participant — ${stage?.name}`
                  : `Controlekaart — ${stage?.name}, EQ ${eq}`}
            </h2>
            {stageChosen && needsStageStep && (
              <button
                onClick={backToStageStep}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                &larr; Change stage
              </button>
            )}
          </div>
          <div className="p-4">
            {loading ? (
              <div className="text-center p-12">
                <p className="text-xl text-gray-600">Loading rally&hellip;</p>
              </div>
            ) : stages.length === 0 ? (
              <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <p className="mb-6 text-xl text-gray-700">
                  No stages available. Add a stage to this rally first.
                </p>
                <Link
                  href={`/rallies/${rallyId}/stages/new`}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block text-lg font-bold shadow-md"
                >
                  Add Stage
                </Link>
              </div>
            ) : !stageChosen ? (
              // Step 1 — only shown when there is more than one stage to pick
              // from; a single-stage rally skips straight to the EQ step.
              <div className="p-2">
                <p className="text-sm text-gray-600 mb-3">
                  This rally has {stages.length} stages — pick which controlekaart you are typing.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {stages.map((candidate, index) => {
                    const count = sheets.filter((sheet) => sheet.stageId === candidate._id).length;
                    return (
                      <button
                        key={candidate._id}
                        type="button"
                        onClick={() => setStageId(candidate._id)}
                        className="flex items-center justify-between gap-3 px-4 py-3 border-2 border-gray-200 rounded-lg text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        <span className="font-semibold text-gray-900">
                          <span className="text-gray-400 mr-2">{index + 1}.</span>
                          {candidate.name}
                        </span>
                        <span className="text-sm text-gray-500 whitespace-nowrap">
                          {count} sheet{count === 1 ? '' : 's'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : eq === null ? (
              // Step 2 — pick the EQ. A crew that already has a sheet for this
              // stage opens it for editing instead of being greyed out.
              <div className="p-2">
                {participants.length === 0 && eqRows.length === 0 ? (
                  <p className="text-base text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
                    This rally has no entry list yet.{' '}
                    <Link href={`/rallies/${rallyId}`} className="underline font-semibold">
                      Import it
                    </Link>{' '}
                    before typing cards.
                  </p>
                ) : (
                  <>
                    <input
                      type="search"
                      value={eqSearch}
                      onChange={(event) => setEqSearch(event.target.value)}
                      placeholder="Search EQ or crew"
                      aria-label="Search participants"
                      className="w-full sm:w-72 mb-3 px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {visibleEqRows.length === 0 ? (
                      <p className="text-base text-gray-600">No participant matches this search.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[32rem] overflow-y-auto pr-1">
                        {visibleEqRows.map((row) => {
                          const taken = Boolean(row.sheet);
                          const name = row.participant ? crewLabel(row.participant) : '';
                          return (
                            <button
                              key={row.eq}
                              type="button"
                              onClick={() =>
                                taken
                                  ? router.push(`/rallies/${rallyId}/answer-sheets/${row.sheet!._id}/edit`)
                                  : setEq(row.eq)
                              }
                              className={`flex items-center justify-between gap-2 px-3 py-2 border-2 rounded-lg text-left transition-colors ${
                                taken
                                  ? 'border-amber-200 bg-amber-50 hover:border-amber-400'
                                  : 'border-gray-200 hover:border-green-500 hover:bg-green-50'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-gray-900">{row.eq}</span>
                                {row.participant && (
                                  <ClassificationBadge classification={row.participant.classification} />
                                )}
                                <span className="truncate text-sm text-gray-700">
                                  {name || (row.participant ? '' : 'not on entry list')}
                                </span>
                              </span>
                              <span
                                className={`text-xs font-semibold whitespace-nowrap ${
                                  taken ? 'text-amber-800' : 'text-green-700'
                                }`}
                              >
                                {taken ? 'Edit sheet' : 'Enter sheet'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              // Step 3 — the card itself, for the stage and EQ already picked.
              <AnswerSheetForm
                onSubmit={handleSubmit}
                stages={stages}
                sheets={sheets}
                participants={participants}
                initialData={{ eq, stageId }}
                lockSelection
                onChangeSelection={backToEqStep}
              />
            )}
          </div>
        </div>

        <div className="mt-8">
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Rally
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full">
            <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-2xl font-bold text-center text-gray-800">Submitting answer sheet...</p>
          </div>
        </div>
      )}
    </div>
  );
}
