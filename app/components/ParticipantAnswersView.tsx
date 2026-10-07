import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calculateMerkPenalty, calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, MerkKeyRow, ScoreKeyRow } from '../lib/scoring';
import { blankSheetPenalties } from '../lib/missingSheets';
import { legPositions, type RallyRoute } from '../lib/routes';
import { resolveStatus } from '../lib/standings';
import type { StageTimeConfig, TimeKeyRow } from '../lib/timeScoring';
import ControlekaartCard, { sumStrafp } from './ControlekaartCard';
import type { MerkScoreRow, TimePenaltyRow } from './ControlekaartCard';
import ClassificationBadge from './ClassificationBadge';
import ParticipantDetailsForm from './ParticipantDetailsForm';
import { useAuth } from './AuthContext';
import { crewLabel, type ClassificationValue } from '../lib/participants';
import { PAGE_CONTAINER } from '../lib/pageContainer';

interface Rally {
  _id: string;
  name: string;
}

interface Stage {
  _id: string;
  name: string;
  // The route (leg) this stage is ridden in, so the page can group a crew's
  // rally by leg and ask which finish is the rally's own. Null on a rally with
  // no routes.
  routeId?: string | null;
  createdAt: string;
  scoreKey: ScoreKeyRow[];
  // The time key and settings are only read for the maximum a stage can cost —
  // the time penalties of a sheet are scored server-side and stored on its rows.
  timeScoreKey?: TimeKeyRow[];
  timeConfig?: Partial<StageTimeConfig>;
  merkScoreKey?: MerkKeyRow[];
}

interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  answers: AnswerRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
  diversenCount?: number;
  totalPenalty: number;
  timePenalty?: number;
  disqualified?: boolean;
  submittedAt: string;
}

// The crew behind this EQ number, when somebody has recorded it.
interface ParticipantDetails {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface ParticipantAnswersViewProps {
  rallyId: string;
  eq: number;
}

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Everything one participant submitted for a rally: their answers for every
// stage, stage by stage, scored against each stage's answer key. Each stage is
// laid out as the four columns of the SARK controlekaart — ORC's 1-15, ORC's
// 16-30, the officials' time column and Merk + totals — so it reads like the
// paper card the answers were copied from. A stage the participant has no sheet
// for is listed as missing and scored as a blank card
// (app/lib/missingSheets.ts), exactly as the standings score it — the total on
// this page is the one the standings rank on.
const ParticipantAnswersView: React.FC<ParticipantAnswersViewProps> = ({ rallyId, eq }) => {
  const { can } = useAuth();
  const router = useRouter();
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sheets, setSheets] = useState<AnswerSheet[]>([]);
  const [details, setDetails] = useState<ParticipantDetails | null>(null);
  const [editingDetails, setEditingDetails] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  // The rally's legs. Empty on a rally with no routes, and then this page lists
  // the crew's stages the way it always did.
  const [routes, setRoutes] = useState<RallyRoute[]>([]);
  // The EQ numbers of the entry list, to step to the previous and the next crew
  // without going back to the rally.
  const [entryEqs, setEntryEqs] = useState<number[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [rallyRes, stagesRes, sheetsRes, detailsRes, routesRes, participantsRes] =
        await Promise.all([
          fetch(`/api/rallies/${rallyId}`),
          fetch(`/api/stages?rallyId=${rallyId}`),
          fetch(`/api/answersheets?rallyId=${rallyId}&eq=${eq}`),
          fetch(`/api/rallies/${rallyId}/participants/${eq}`),
          fetch(`/api/rallies/${rallyId}/routes`),
          fetch(`/api/rallies/${rallyId}/participants`),
        ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      if (!stagesRes.ok) throw new Error('Failed to fetch stages');
      setStages(await stagesRes.json());

      if (routesRes.ok) {
        const data = await routesRes.json();
        setRoutes(data.routes || []);
      }

      // Only the previous/next buttons read it: without it they are not shown.
      if (participantsRes.ok) {
        const participants: { eq: number }[] = await participantsRes.json();
        setEntryEqs(participants.map((participant) => participant.eq).sort((a, b) => a - b));
      }

      if (!sheetsRes.ok) throw new Error('Failed to fetch answer sheets');
      setSheets(await sheetsRes.json());

      // A 404 here only means nobody has recorded who this EQ is yet — the
      // participant is still whatever sheets they handed in.
      setDetails(detailsRes.ok ? await detailsRes.json() : null);
    } catch (err) {
      setError('Failed to load this participant. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId, eq]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // One stage of this participant. Their delta chains through the rally, so the
  // whole page is reloaded: the time penalties of their later stages move too.
  const handleDeleteSheet = async (sheetId: string, stageName: string) => {
    if (
      !window.confirm(
        `Delete the answer sheet of participant ${eq} for ${stageName}? Their sheets for the other stages stay. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/answersheets/${sheetId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete answer sheet');
      await loadData();
    } catch (err) {
      setError('Failed to delete this answer sheet. Please try again.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  // Removing a participant from the rally deletes their details and every sheet
  // they have in it.
  const handleDeleteParticipant = async () => {
    if (
      !window.confirm(
        `Delete participant ${eq} from this rally? Their details and all ${sheets.length} of their answer sheets will be deleted. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/${eq}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete participant');
      router.push(`/rallies/${rallyId}`);
    } catch (err) {
      setError('Failed to delete this participant. Please try again.');
      console.error(err);
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading participant...</p>
      </div>
    );
  }

  // Only a failed load takes over the page; an error from a delete is shown as a
  // banner above the participant's sheets, which are still on screen.
  if (!rally) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  // Stage order (creation order) is the running order of the rally, so the
  // participant's sheets read like their route through the event.
  //
  // Penalties are recomputed from the stage answer keys rather than read from
  // the stored totals, so every number on the page — row, stage and grand total
  // — comes from the same source even if a key was edited after submission.
  //
  // A stage with no sheet is not a stage ridden for free: it is scored as the
  // blank card it stands for, the same numbers the standings add for it, so this
  // page and the standings show one total.
  const sheetsByStage = new Map(sheets.map((sheet) => [sheet.stageId, sheet]));
  // Where each stage sits in the rally's legs — which finish carries no break
  // and which one is the rally's own. A rally with no routes is one leg, so this
  // says what `index === stages.length - 1` used to say.
  const legs = legPositions(stages);
  // The heading to draw before a stage, when it opens a leg. Null on a rally
  // with no routes — one leg needs no heading, and the list then reads exactly
  // as it did before routes existed.
  const routeHeadingFor = (index: number) => {
    if (routes.length === 0 || !legs[index]?.startsRoute) return null;
    const position = routes.findIndex((route) => route._id === legs[index].routeId);
    return {
      name: position >= 0 ? routes[position].name : 'Zonder route',
      position: position + 1,
      stageCount: legs.filter((leg) => leg.routeId === legs[index].routeId).length,
    };
  };
  const entries = stages.map((stage, index) => {
    const sheet = sheetsByStage.get(stage._id);
    const timeRows = sheet?.timePenalties || [];
    const merkRows = sheet?.merkScores || [];

    if (!sheet) {
      const blank = blankSheetPenalties(stage, legs[index]);
      return {
        stage,
        routeHeading: routeHeadingFor(index),
        sheet,
        timeRows,
        merkRows,
        orcPenalty: blank.orcPenalty,
        tijdTotal: blank.timePenalty,
        diversenTotal: blank.merkPenalty,
      };
    }

    return {
      stage,
      routeHeading: routeHeadingFor(index),
      sheet,
      timeRows,
      merkRows,
      orcPenalty: calculateTotalPenalty(stage.scoreKey, sheet.answers),
      tijdTotal: sumStrafp(timeRows),
      diversenTotal: calculateMerkPenalty(stage.merkScoreKey, merkRows, sheet.diversenCount)
        .totalPenalty,
    };
  });

  const orcTotal = entries.reduce((total, entry) => total + entry.orcPenalty, 0);
  const tijdTotal = entries.reduce((total, entry) => total + entry.tijdTotal, 0);
  const diversenTotal = entries.reduce((total, entry) => total + entry.diversenTotal, 0);
  const disqualified = sheets.some((sheet) => sheet.disqualified);
  // The same three groups the standings rank in (app/lib/standings.ts): a crew
  // with no card at all did not start, and a crew whose last stage has no card —
  // or whose last card is outside the finish window — started but did not
  // finish. Both are ranked behind the field.
  // A rally with no stages has nothing to start, so nobody has failed to start
  // it — the same exception the standings route makes.
  const lastStage = stages.length > 0 ? stages[stages.length - 1] : undefined;
  const status =
    stages.length === 0
      ? 'finished'
      : resolveStatus({
          sheetsSubmitted: sheets.length,
          disqualified,
          missingLastStageSheet: Boolean(lastStage && !sheetsByStage.has(lastStage._id)),
        });
  const crew = crewLabel(details);

  // The neighbours on the entry list. Worked out from the list rather than from
  // this EQ's place in it, so an EQ with sheets but no entry still has both.
  const previousEq = entryEqs.filter((candidate) => candidate < eq).at(-1);
  const nextEq = entryEqs.find((candidate) => candidate > eq);
  const navButtonClass =
    'inline-flex items-center px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base shadow-sm transition-colors';
  const participantNav =
    previousEq !== undefined || nextEq !== undefined ? (
      <div className="flex flex-wrap justify-between gap-3">
        {previousEq !== undefined ? (
          <Link href={`/rallies/${rallyId}/participants/${previousEq}`} className={navButtonClass}>
            &larr; Previous Participant (EQ {previousEq})
          </Link>
        ) : (
          <span />
        )}
        {nextEq !== undefined && (
          <Link href={`/rallies/${rallyId}/participants/${nextEq}`} className={navButtonClass}>
            Next Participant (EQ {nextEq}) &rarr;
          </Link>
        )}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className={`${PAGE_CONTAINER} py-4`}>
        {participantNav && <div className="mb-4">{participantNav}</div>}

        <div className="mb-4 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Participant {eq}
              {crew ? ` — ${crew}` : ''} — {rally.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <ClassificationBadge
                classification={details?.classification}
                fallback="No classification"
              />
              <span className="text-gray-700 text-base">
                {details ? (
                  <>
                    Driver: {details.driverName || '—'} · Navigator:{' '}
                    {details.navigatorName || '—'}
                  </>
                ) : (
                  'No participant details recorded yet.'
                )}
              </span>
            </div>
            <p className="text-gray-700 text-base">
              Every answer this participant submitted, stage by stage, scored against each
              stage&apos;s answer key.
            </p>
          </div>
          {/* The crew behind the number is the entry list, which is an admin's.
              The sheets below are not: typing and correcting them is what a
              data-entry account is for. */}
          {can('manage:rally') && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setEditingDetails((editing) => !editing)}
                disabled={busy}
                className="px-5 py-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-base shadow-md transition-colors disabled:opacity-60"
              >
                {editingDetails ? 'Close' : details ? 'Edit Details' : 'Add Details'}
              </button>
              {(sheets.length > 0 || details) && (
                <button
                  onClick={handleDeleteParticipant}
                  disabled={busy}
                  className="px-5 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-base shadow-md transition-colors disabled:opacity-60"
                  title={`Delete the details and every answer sheet of participant ${eq} in this rally`}
                >
                  Delete Participant {eq}
                </button>
              )}
            </div>
          )}
        </div>

        {editingDetails && (
          <div className="bg-white rounded-xl shadow-xl p-4 mb-4">
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              Classification and crew of participant {eq}
            </h2>
            <ParticipantDetailsForm
              rallyId={rallyId}
              lockedEq={eq}
              initial={details || undefined}
              onSaved={async () => {
                setEditingDetails(false);
                await loadData();
              }}
              onCancel={() => setEditingDetails(false)}
            />
          </div>
        )}

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{error}</p>
          </div>
        )}

        {/* Summary */}
        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Participant (EQ)
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{eq}</p>
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Sheets Submitted
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {sheets.length}
                {stages.length > 0 ? ` / ${stages.length}` : ''}
              </p>
              {stages.length > sheets.length && (
                <p className="text-sm font-semibold text-amber-700 mt-1">
                  {stages.length - sheets.length} stage
                  {stages.length - sheets.length === 1 ? '' : 's'} without a sheet — scored as a
                  blank card
                </p>
              )}
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Strafpunten
              </p>
              <p className="text-3xl font-bold text-red-600 mt-1">
                {orcTotal + tijdTotal + diversenTotal}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                ORC&apos;s {orcTotal} + Tijd {tijdTotal} + Diversen {diversenTotal} — counts for
                the standings
              </p>
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Diversen
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{diversenTotal}</p>
              <p className="text-sm text-gray-600 mt-1">The merk column of every stage</p>
            </div>
          </div>
        </div>

        {status === 'dns' && (
          <div className="bg-gray-200 border-l-4 border-gray-500 text-gray-800 px-6 py-3 rounded-lg mb-6 text-base font-bold shadow-md">
            DNS — did not start: no answer sheet has been typed for this participant in this
            rally. They are listed behind the whole field in the standings.
          </div>
        )}

        {status === 'dnf' && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-800 px-6 py-3 rounded-lg mb-6 text-base font-bold shadow-md">
            DNF — did not finish:{' '}
            {disqualified
              ? `this participant passed the finish of the last stage${
                  routes.length > 0 ? ' of the last route' : ''
                } outside its window, or has no finish time on it.`
              : `no answer sheet was handed in for the last stage${
                  routes.length > 0 ? ' of the last route' : ''
                } (${lastStage?.name}).`}{' '}
            They are ranked behind everyone who finished; their points stand.
          </div>
        )}

        {stages.length === 0 ? (
          <div className="bg-white rounded-xl shadow-xl p-12 text-center">
            <p className="text-xl text-gray-700">
              This rally has no stages yet, so there is nothing for this participant to submit.
            </p>
          </div>
        ) : (
          entries.map(({ stage, routeHeading, sheet, orcPenalty, tijdTotal: stageTijdTotal, diversenTotal: stageDiversenTotal }) => {
            // One heading per leg, drawn before the leg's first stage.
            const heading = routeHeading && (
              <h2
                key={`route-${routeHeading.position}`}
                className="text-base font-bold uppercase tracking-wide text-indigo-900 border-b-2 border-indigo-200 pb-1 mb-3 mt-8 first:mt-0"
              >
                <span className="text-indigo-400 mr-2">Route {routeHeading.position}:</span>
                {routeHeading.name}
                <span className="ml-3 text-xs font-normal normal-case text-gray-600">
                  {routeHeading.stageCount} stage{routeHeading.stageCount === 1 ? '' : 's'} — the
                  delta starts again here
                </span>
              </h2>
            );

            if (!sheet) {
              return (
                <React.Fragment key={stage._id}>
                {heading}
                <div
                  className="bg-white rounded-xl shadow-lg border-2 border-dashed border-amber-400 p-6 mb-6"
                >
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">{stage.name}</h2>
                      <p className="text-base text-gray-700 mt-1">
                        No answer sheet submitted for this stage — scored as a blank card.
                      </p>
                    </div>
                    <span className="text-lg font-bold text-red-600 whitespace-nowrap">
                      {orcPenalty + stageTijdTotal + stageDiversenTotal} penalty points
                      <span className="ml-2 text-sm font-semibold text-gray-600">
                        (ORC&apos;s {orcPenalty} + Tijd {stageTijdTotal} + Diversen{' '}
                        {stageDiversenTotal})
                      </span>
                    </span>
                  </div>
                  <Link
                    href={`/rallies/${rallyId}/answer-sheets`}
                    className="text-blue-600 hover:underline font-medium text-base mt-2 inline-block"
                  >
                    Enter an answer sheet &rarr;
                  </Link>
                </div>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={stage._id}>
              {heading}
              <div
                className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6"
              >
                <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{stage.name}</h2>
                    <p className="text-sm text-gray-600">
                      Submitted: {formatDate(sheet.submittedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-lg font-bold text-red-600">
                      {orcPenalty + stageTijdTotal + stageDiversenTotal} penalty points
                      <span className="ml-2 text-sm font-semibold text-gray-600">
                        (ORC&apos;s {orcPenalty} + Tijd {stageTijdTotal} + Diversen{' '}
                        {stageDiversenTotal})
                      </span>
                    </span>
                    <Link
                      href={`/rallies/${rallyId}/answer-sheets/${sheet._id}`}
                      className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-base transition-colors"
                    >
                      View Score
                    </Link>
                    <Link
                      href={`/rallies/${rallyId}/answer-sheets/${sheet._id}/edit`}
                      className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-base transition-colors"
                    >
                      Edit Answers
                    </Link>
                    <button
                      onClick={() => handleDeleteSheet(sheet._id, stage.name)}
                      disabled={busy}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-base transition-colors disabled:opacity-60"
                    >
                      Delete Sheet
                    </button>
                  </div>
                </div>

                <ControlekaartCard
                  scoreKey={stage.scoreKey}
                  answers={sheet.answers}
                  timePenalties={sheet.timePenalties}
                  merkScoreKey={stage.merkScoreKey}
                  merkScores={sheet.merkScores}
                  diversenCount={sheet.diversenCount}
                  disqualified={sheet.disqualified}
                />
              </div>
              </React.Fragment>
            );
          })
        )}

        {participantNav && <div className="mt-8">{participantNav}</div>}

        <div className="mt-8 flex flex-wrap gap-6">
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Rally
          </Link>
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            Answer Sheets &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ParticipantAnswersView;
