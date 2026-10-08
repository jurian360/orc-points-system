import 'server-only';

// Moving a rally between two installations of this app as a file: the server
// and a laptop running it offline in Docker (see "Offline use" in CLAUDE.md).
// The databases never talk to each other — an admin exports a rally on one side
// and imports the file on the other, through the app's own guarded routes.
//
// The file carries what officials *typed*, never what was scored: the rally,
// its routes, its stages with their keys, the entry list and the letters, WPT's
// and merk letters of every sheet. Every penalty is re-derived by `rescoreRally`
// on import, so a file cannot claim a total it did not earn — the same rule the
// answer-sheet routes follow. No accounts, QR codes or public-results switch.
//
// Things are matched by what both sides agree on rather than by database id:
// the rally by its code, a route by its name, a stage by its card number
// (`cardId`, assigned on export if it had none), a crew by its EQ. An import
// adds and updates; it never deletes a stage, a crew or a sheet, because a file
// that left something out must not be able to take answer sheets with it.

import { AnswerSheet, Participant, Rally, Route, Stage } from '../models';
import { ensureRallyCode, ensureStageCardId, parseCardId } from './appCards';
import { parseRallyCode } from './rallyCodes';
import { loadRunningOrder } from './rallyOrder';
import { rescoreRally } from './rescore';
import {
  MAX_IMPORT_PARTICIPANTS,
  MAX_ROUTES,
  MAX_STAGES,
  MERK_ROWS_PER_CARD,
  ORC_ROWS_PER_CARD,
  parseAnswerRows,
  parseClassification,
  parseDiversenCount,
  parseEq,
  parseMerkScores,
  parseName,
  parseOptionalName,
  parseTimePenalties,
  processScoreKey,
  type NormalizedScoreKey,
} from './validation';

export const RALLY_EXPORT_FORMAT = 'orc-rally-export';
export const RALLY_EXPORT_VERSION = 1;

// --- Export ----------------------------------------------------------------

// The export file of one rally, or null when it does not exist.
export async function buildRallyExport(rallyId: string) {
  const rally = await Rally.findById(rallyId);
  if (!rally) return null;

  // The file is matched on the other side by the rally code and the card
  // numbers, so a rally or a stage that has none yet gets one now — the same
  // first-use numbering the QR page does.
  const code = await ensureRallyCode(rally);
  const { stages, routes } = await loadRunningOrder(rallyId);
  for (const stage of stages) await ensureStageCardId(stage);

  const routeName = new Map<string, string>(
    routes.map((route: any) => [String(route._id), route.name])
  );
  const cardIdByStage = new Map<string, number>(
    stages.map((stage: any) => [String(stage._id), stage.cardId])
  );

  const [participants, sheets] = await Promise.all([
    Participant.find({ rallyId }).sort({ eq: 1 }).lean(),
    AnswerSheet.find({ rallyId }).sort({ eq: 1 }).lean(),
  ]);

  return {
    format: RALLY_EXPORT_FORMAT,
    version: RALLY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    rally: { name: rally.name, code },
    routes: routes.map((route: any) => ({ name: route.name })),
    // In running order. `createdAt` is carried so the order inside a route
    // survives the trip: it is what the stages of a route are sorted on.
    stages: stages.map((stage: any) => ({
      cardId: stage.cardId,
      name: stage.name,
      route: stage.routeId ? routeName.get(String(stage.routeId)) ?? null : null,
      createdAt: stage.createdAt,
      usesSecondCard: Boolean(stage.usesSecondCard),
      // processScoreKey on the import reads only the fields it knows, so the
      // stored keys go out as they are; the `_id`s inside are ignored there.
      scoreKey: stage.scoreKey,
      timeScoreKey: stage.timeScoreKey,
      merkScoreKey: stage.merkScoreKey,
      timeConfig: stage.timeConfig,
    })),
    participants: participants.map((participant: any) => ({
      eq: participant.eq,
      classification: participant.classification || '',
      driverName: participant.driverName || '',
      navigatorName: participant.navigatorName || '',
    })),
    // What was typed only: the letters, the WPT's, the merk letters and the
    // Diversen count. The points are scored again on the other side.
    answerSheets: sheets
      .filter((sheet: any) => cardIdByStage.has(String(sheet.stageId)))
      .map((sheet: any) => ({
        eq: sheet.eq,
        stage: cardIdByStage.get(String(sheet.stageId)),
        answers: (sheet.answers || []).map((row: any) => ({
          rowNumber: row.rowNumber,
          selectedAnswers: row.selectedAnswers || [],
        })),
        timePenalties: (sheet.timePenalties || [])
          .filter((row: any) => row.wpt)
          .map((row: any) => ({ rowNumber: row.rowNumber, wpt: row.wpt })),
        merkScores: (sheet.merkScores || []).map((row: any) => ({
          rowNumber: row.rowNumber,
          merk: row.merk || '',
        })),
        diversenCount: sheet.diversenCount || 0,
      })),
  };
}

// --- Import ----------------------------------------------------------------

interface ImportStage extends NormalizedScoreKey {
  cardId: number;
  name: string;
  route: string | null;
  createdAt: Date;
  usesSecondCard: boolean;
}

export interface RallyImport {
  rally: { name: string; code: string };
  routes: string[];
  stages: ImportStage[];
  participants: {
    eq: number;
    classification: string;
    driverName: string;
    navigatorName: string;
  }[];
  answerSheets: {
    eq: number;
    stage: number;
    answers: ReturnType<typeof parseAnswerRows>;
    timePenalties: ReturnType<typeof parseTimePenalties>;
    merkScores: ReturnType<typeof parseMerkScores>;
    diversenCount: number;
  }[];
}

type ParseResult = { ok: true; value: RallyImport } | { ok: false; error: string };

function list(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Validates a whole export file before anything is written: one bad entry
// rejects the import, because a half-imported rally is worse than none — the
// same rule the entry-list import follows. Every value goes through the parser
// its own route uses.
export function parseRallyImport(body: Record<string, unknown>): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });

  if (body.format !== RALLY_EXPORT_FORMAT) {
    return fail('This is not a rally export file');
  }
  if (body.version !== RALLY_EXPORT_VERSION) {
    return fail('This export file was made by a different version of the app');
  }

  const rallyRaw = record(body.rally);
  const rallyName = parseName(rallyRaw.name);
  const rallyCode = parseRallyCode(rallyRaw.code);
  if (!rallyName || !rallyCode) return fail('The rally in the file has no valid name or code');

  // Routes: the legs, in order, by name.
  const routesRaw = list(body.routes ?? []);
  if (!routesRaw || routesRaw.length > MAX_ROUTES) return fail('The routes in the file are not valid');
  const routes: string[] = [];
  for (const entry of routesRaw) {
    const name = parseName(record(entry).name);
    if (!name || routes.includes(name)) return fail('A route in the file has no name or a duplicate one');
    routes.push(name);
  }

  // Stages, in running order.
  const stagesRaw = list(body.stages);
  if (!stagesRaw || stagesRaw.length > MAX_STAGES) return fail('The stages in the file are not valid');
  const stages: ImportStage[] = [];
  const stageByCard = new Map<number, ImportStage>();
  for (const [index, entry] of stagesRaw.entries()) {
    const raw = record(entry);
    const where = `Stage ${index + 1}`;

    const cardId = parseCardId(raw.cardId);
    if (cardId === null || stageByCard.has(cardId)) {
      return fail(`${where}: missing or duplicate card number`);
    }
    const name = parseName(raw.name);
    if (!name) return fail(`${where}: the stage has no valid name`);

    // A rally either has routes and every stage is in one, or has none.
    let route: string | null = null;
    if (routes.length > 0) {
      if (typeof raw.route !== 'string' || !routes.includes(raw.route)) {
        return fail(`${where}: the stage is not in one of the rally's routes`);
      }
      route = raw.route;
    } else if (raw.route !== null && raw.route !== undefined) {
      return fail(`${where}: the stage names a route, but the rally has none`);
    }

    // Only a date that parses is kept; anything else lands at the end of its
    // route, stamped in file order below.
    const created = typeof raw.createdAt === 'string' ? new Date(raw.createdAt) : null;
    const createdAt =
      created && !Number.isNaN(created.getTime()) ? created : new Date(Date.now() + index);

    const usesSecondCard = raw.usesSecondCard === true;
    const key = processScoreKey(
      raw,
      usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD,
      usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD
    );

    const stage = { ...key, cardId, name, route, createdAt, usesSecondCard };
    stages.push(stage);
    stageByCard.set(cardId, stage);
  }

  // The entry list.
  const participantsRaw = list(body.participants ?? []);
  if (!participantsRaw || participantsRaw.length > MAX_IMPORT_PARTICIPANTS) {
    return fail('The participants in the file are not valid');
  }
  const participants: RallyImport['participants'] = [];
  const entered = new Set<number>();
  for (const entry of participantsRaw) {
    const raw = record(entry);
    const eq = parseEq(raw.eq);
    if (eq === null || entered.has(eq)) return fail('A participant in the file has no valid or a duplicate EQ');
    const classification = parseClassification(raw.classification);
    const driverName = parseOptionalName(raw.driverName);
    const navigatorName = parseOptionalName(raw.navigatorName);
    if (classification === null || driverName === null || navigatorName === null) {
      return fail(`EQ ${eq}: the class or a name is not valid`);
    }
    entered.add(eq);
    participants.push({ eq, classification, driverName, navigatorName });
  }

  // The sheets. A sheet belongs to a crew of the entry list and to a stage of
  // the file, exactly as an official's sheet has to.
  const sheetsRaw = list(body.answerSheets ?? []);
  if (!sheetsRaw || sheetsRaw.length > stages.length * MAX_IMPORT_PARTICIPANTS) {
    return fail('The answer sheets in the file are not valid');
  }
  const answerSheets: RallyImport['answerSheets'] = [];
  const seenSheets = new Set<string>();
  for (const entry of sheetsRaw) {
    const raw = record(entry);
    const eq = parseEq(raw.eq);
    const cardId = parseCardId(raw.stage);
    const stage = cardId === null ? undefined : stageByCard.get(cardId);
    if (eq === null || !entered.has(eq) || !stage) {
      return fail('An answer sheet in the file is not for a participant and a stage of the rally');
    }
    const sheetKey = `${stage.cardId}:${eq}`;
    if (seenSheets.has(sheetKey)) return fail(`EQ ${eq} has two sheets for stage "${stage.name}"`);
    seenSheets.add(sheetKey);

    const diversenCount = parseDiversenCount(raw.diversenCount);
    if (diversenCount === null) return fail(`EQ ${eq}, stage "${stage.name}": Diversen is not valid`);

    answerSheets.push({
      eq,
      stage: stage.cardId,
      answers: parseAnswerRows(
        raw.answers,
        stage.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD
      ),
      timePenalties: parseTimePenalties(raw.timePenalties),
      merkScores: parseMerkScores(
        raw.merkScores,
        stage.usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD
      ),
      diversenCount,
    });
  }

  return {
    ok: true,
    value: {
      rally: { name: rallyName, code: rallyCode },
      routes,
      stages,
      participants,
      answerSheets,
    },
  };
}

// Writes a validated import: the rally with that code is updated, or created
// when this side has none. Then the whole rally is re-scored.
//
// MongoDB gives these writes no transaction on a standalone server, so they are
// ordered to fail safe — the setup before the crews, the crews before their
// sheets — and everything that could be refused was refused by
// `parseRallyImport` before the first one. An import that does fail half-way
// is completed by importing the same file again: every write is an upsert.
export async function applyRallyImport(data: RallyImport) {
  let rally = await Rally.findOne({ code: data.rally.code });
  const created = !rally;
  if (rally) {
    rally.name = data.rally.name;
    await rally.save();
  } else {
    rally = await new Rally({ name: data.rally.name, code: data.rally.code }).save();
  }
  const rallyId = rally._id;

  // Routes, matched by name and numbered in the file's order.
  const routeIds = new Map<string, unknown>();
  const existingRoutes = await Route.find({ rallyId });
  for (const [index, name] of data.routes.entries()) {
    let route = existingRoutes.find((entry: any) => entry.name === name);
    if (route) {
      route.order = index + 1;
      await route.save();
    } else {
      route = await new Route({ rallyId, name, order: index + 1 }).save();
    }
    routeIds.set(name, route._id);
  }

  // Stages, matched by card number.
  if (data.stages.length > 0) {
    await Stage.bulkWrite(
      data.stages.map((stage) => {
        const set: Record<string, unknown> = {
          name: stage.name,
          createdAt: stage.createdAt,
          usesSecondCard: stage.usesSecondCard,
          scoreKey: stage.scoreKey,
          timeScoreKey: stage.timeScoreKey,
          merkScoreKey: stage.merkScoreKey,
          timeConfig: stage.timeConfig,
        };
        const update: Record<string, unknown> = { $set: set };
        if (stage.route) set.routeId = routeIds.get(stage.route);
        else update.$unset = { routeId: '' };
        return {
          updateOne: { filter: { rallyId, cardId: stage.cardId }, update, upsert: true },
        };
      })
    );

    // The card counter has to stay ahead of the numbers just written, or the
    // next stage created on this side would be handed one of them.
    const highest = Math.max(...data.stages.map((stage) => stage.cardId));
    await Rally.updateOne({ _id: rallyId }, { $max: { cardIdSeq: highest } });
  }

  // A route this side has and the file does not is dropped once it is empty —
  // never while it holds a stage, the same rule DELETE on a route follows.
  for (const route of existingRoutes) {
    if (data.routes.includes(route.name)) continue;
    if ((await Stage.countDocuments({ routeId: route._id })) === 0) {
      await Route.deleteOne({ _id: route._id });
    }
  }

  // The entry list.
  const now = new Date();
  if (data.participants.length > 0) {
    await Participant.bulkWrite(
      data.participants.map((participant) => ({
        updateOne: {
          filter: { rallyId, eq: participant.eq },
          update: {
            $set: {
              classification: participant.classification,
              driverName: participant.driverName,
              navigatorName: participant.navigatorName,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      }))
    );
  }

  // The sheets, on the stages as they are now stored.
  const stored = await Stage.find({ rallyId }).select('cardId');
  const stageIdByCard = new Map<number, unknown>(
    stored.map((stage: any) => [stage.cardId, stage._id])
  );
  if (data.answerSheets.length > 0) {
    await AnswerSheet.bulkWrite(
      data.answerSheets.map((sheet) => ({
        updateOne: {
          filter: { stageId: stageIdByCard.get(sheet.stage), eq: sheet.eq },
          update: {
            $set: {
              rallyId,
              answers: sheet.answers,
              timePenalties: sheet.timePenalties,
              merkScores: sheet.merkScores,
              diversenCount: sheet.diversenCount,
            },
            $setOnInsert: { submittedAt: now },
          },
          upsert: true,
        },
      }))
    );
  }

  // Every number on the sheets is derived again here: the time chain, the ORC
  // and merk penalties and the totals the standings read.
  await rescoreRally(rallyId);

  return {
    rallyId: String(rallyId),
    created,
    stages: data.stages.length,
    participants: data.participants.length,
    answerSheets: data.answerSheets.length,
  };
}
