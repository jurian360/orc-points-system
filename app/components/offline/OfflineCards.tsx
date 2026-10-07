'use client';

// The Cards tab of the offline workspace (app/offline): the answer-sheets
// wizard of /rallies/[id]/answer-sheets — stage, EQ, card — over the copy of the
// rally in the browser. The card is typed in `AnswerSheetForm`, the very form
// the online pages use, and shown scored in `ControlekaartCard`; only where the
// card is saved differs (app/lib/offline/store.ts `saveLocalSheet`).

import React, { useMemo, useState } from 'react';
import AnswerSheetForm from '../AnswerSheetForm';
import ClassificationBadge from '../ClassificationBadge';
import ControlekaartCard from '../ControlekaartCard';
import { crewLabel } from '../../lib/participants';
import {
  deleteLocalSheet,
  saveLocalSheet,
  type OfflineRally,
  type OfflineSheet,
  type ScoredOfflineSheet,
  type TypedCard,
} from '../../lib/offline/store';

interface OfflineCardsProps {
  rally: OfflineRally;
  records: OfflineSheet[];
  // The live cards, scored (`scoreOfflineRally`).
  scored: ScoredOfflineSheet[];
}

type View =
  | { kind: 'pick' }
  | { kind: 'new'; eq: number }
  | { kind: 'card'; key: string }
  | { kind: 'edit'; key: string };

// What the EQ grid says about a crew's card for the stage.
function cardState(record: OfflineSheet | undefined) {
  if (!record || record.deleted) {
    return record?.deleted
      ? { label: 'Delete waiting', className: 'border-gray-300 bg-gray-50 text-gray-600' }
      : { label: 'Enter sheet', className: 'border-gray-200 hover:border-green-500 hover:bg-green-50 text-green-700' };
  }
  if (record.conflict) {
    return { label: 'Conflict', className: 'border-red-300 bg-red-50 hover:border-red-500 text-red-700' };
  }
  if (record.dirty) {
    return { label: 'To upload', className: 'border-amber-300 bg-amber-50 hover:border-amber-500 text-amber-800' };
  }
  return { label: 'Uploaded', className: 'border-blue-200 bg-blue-50 hover:border-blue-400 text-blue-800' };
}

export default function OfflineCards({ rally, records, scored }: OfflineCardsProps) {
  const stages = rally.stages;
  const [stageId, setStageId] = useState<string>(stages.length === 1 ? String(stages[0]._id) : '');
  const [view, setView] = useState<View>({ kind: 'pick' });
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stage = stages.find((candidate) => String(candidate._id) === stageId);
  const recordByKey = useMemo(() => new Map(records.map((record) => [record.key, record])), [records]);
  const scoredByKey = useMemo(() => new Map(scored.map((sheet) => [sheet.key, sheet])), [scored]);
  const participants = useMemo(
    () => [...rally.participants].sort((a, b) => a.eq - b.eq),
    [rally.participants]
  );
  // The form carries a participant's delta through the rally from these, and
  // refuses an EQ that already has a card for the stage.
  const liveSheets = useMemo(() => scored.map((sheet) => ({ ...sheet, _id: sheet.key })), [scored]);

  const keyOf = (eq: number) => `${stageId}:${eq}`;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return participants;
    return participants.filter(
      (participant: any) =>
        String(participant.eq).startsWith(term) ||
        crewLabel(participant).toLowerCase().includes(term)
    );
  }, [participants, search]);

  const open = (eq: number) => {
    setError(null);
    const record = recordByKey.get(keyOf(eq));
    setView(record && !record.deleted ? { kind: 'card', key: record.key } : { kind: 'new', eq });
  };

  const handleSubmit = async (card: TypedCard, previousKey?: string) => {
    setError(null);
    try {
      const saved = await saveLocalSheet(rally.rallyId, card, previousKey);
      setView({ kind: 'card', key: saved.key });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the card on this device.');
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm('Delete this card? The deletion is uploaded with the other changes.')) return;
    await deleteLocalSheet(key);
    setView({ kind: 'pick' });
  };

  if (stages.length === 0) {
    return <p className="text-lg text-gray-700">This rally has no stages.</p>;
  }

  // Step 1 — the stage, when there is more than one.
  if (!stage) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {stages.map((candidate, index) => {
          const count = scored.filter((sheet) => sheet.stageId === String(candidate._id)).length;
          return (
            <button
              key={String(candidate._id)}
              type="button"
              onClick={() => setStageId(String(candidate._id))}
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
    );
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-lg font-bold text-gray-800">{stage.name}</h2>
      <div className="flex gap-4">
        {view.kind !== 'pick' && (
          <button
            onClick={() => setView({ kind: 'pick' })}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            &larr; Participants
          </button>
        )}
        {stages.length > 1 && (
          <button
            onClick={() => {
              setStageId('');
              setView({ kind: 'pick' });
            }}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            &larr; Change stage
          </button>
        )}
      </div>
    </div>
  );

  const errorBanner = error && (
    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded mb-4 font-medium">
      {error}
    </div>
  );

  // Step 2 — the EQ.
  if (view.kind === 'pick') {
    return (
      <div>
        {header}
        {errorBanner}
        {participants.length === 0 ? (
          <p className="text-base text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
            This rally had no entry list when it was downloaded. Import it online, then update
            the offline copy.
          </p>
        ) : (
          <>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search EQ or crew"
              aria-label="Search participants"
              className="w-full sm:w-72 mb-3 px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((participant: any) => {
                const record = recordByKey.get(keyOf(participant.eq));
                const state = cardState(record);
                return (
                  <button
                    key={participant.eq}
                    type="button"
                    onClick={() => open(participant.eq)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 border-2 rounded-lg text-left transition-colors ${state.className}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-gray-900">{participant.eq}</span>
                      <ClassificationBadge classification={participant.classification} />
                      <span className="truncate text-sm text-gray-700">{crewLabel(participant)}</span>
                    </span>
                    <span className="text-xs font-semibold whitespace-nowrap">{state.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Step 3 — a new card.
  if (view.kind === 'new') {
    return (
      <div>
        {header}
        {errorBanner}
        <AnswerSheetForm
          onSubmit={(card) => handleSubmit(card)}
          stages={stages}
          sheets={liveSheets}
          participants={participants}
          initialData={{ eq: view.eq, stageId }}
          lockSelection
          onChangeSelection={() => setView({ kind: 'pick' })}
        />
      </div>
    );
  }

  const record = recordByKey.get(view.key);
  const sheet = scoredByKey.get(view.key);
  if (!record || !sheet) {
    return (
      <div>
        {header}
        <p className="text-base text-gray-700">This card is no longer on this device.</p>
      </div>
    );
  }

  // Correcting a card.
  if (view.kind === 'edit') {
    return (
      <div>
        {header}
        {errorBanner}
        <AnswerSheetForm
          onSubmit={(card) => handleSubmit(card, record.key)}
          stages={stages}
          sheets={liveSheets}
          participants={participants}
          initialData={record}
          isEditing
        />
      </div>
    );
  }

  // The scored card, with the next crew's card one click away: a stage's cards
  // are typed one after another.
  const details = participants.find((participant: any) => participant.eq === sheet.eq);
  const nextParticipant = participants.find((participant: any) => participant.eq > sheet.eq);
  const orcPenalty = sheet.totalPenalty - sheet.timePenalty - sheet.merkPenalty;
  const state = cardState(record);

  return (
    <div>
      {header}
      {errorBanner}
      <div className="mb-3">
        <h3 className="text-xl font-bold text-gray-900">
          EQ {sheet.eq} — {stage.name}
        </h3>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <ClassificationBadge classification={details?.classification} fallback="No classification" />
          <span className="text-gray-700">{crewLabel(details) || 'No participant details'}</span>
          <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${state.className}`}>
            {state.label}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6">
        <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <span className="text-lg font-bold text-red-600">
            {sheet.totalPenalty} penalty points
            <span className="ml-2 text-sm font-semibold text-gray-600">
              (ORC&apos;s {orcPenalty} + Tijd {sheet.timePenalty} + Diversen {sheet.merkPenalty})
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {sheet.disqualified && (
              <span className="px-2 py-1 rounded bg-red-100 text-red-800 text-sm font-bold">DQ</span>
            )}
            {nextParticipant ? (
              <button
                onClick={() => open(nextParticipant.eq)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold shadow-sm"
              >
                Next Participant (EQ {nextParticipant.eq}) &rarr;
              </button>
            ) : (
              <span className="text-sm font-medium text-gray-500">Last participant of the entry list</span>
            )}
            <button
              onClick={() => setView({ kind: 'edit', key: record.key })}
              className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium"
            >
              Edit Answers
            </button>
            <button
              onClick={() => handleDelete(record.key)}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium"
            >
              Delete Sheet
            </button>
          </div>
        </div>
        <ControlekaartCard
          scoreKey={stage.scoreKey || []}
          answers={sheet.answers}
          timePenalties={sheet.timePenalties}
          merkScoreKey={stage.merkScoreKey}
          merkScores={sheet.merkScores}
          diversenCount={sheet.diversenCount}
          disqualified={sheet.disqualified}
        />
      </div>
    </div>
  );
}
