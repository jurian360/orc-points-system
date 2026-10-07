import 'server-only';

// Re-scoring of stored answer sheets.
//
// Both totals on a sheet are denormalised: `totalPenalty` is what the standings
// read, so it has to be recomputed whenever anything it depends on changes. For
// the ORC's and the merk part that is only the sheet and its stage's keys, but
// the time part of a rally is a *chain*: the delta a participant carries out of
// one stage is the starting point of the next, and whether a stage is the last
// one — which decides whether a blown finish window is a penalty or a
// disqualification — changes as soon as a stage is added or deleted.
//
// So a write never rescores a single sheet: it rescores every sheet of the
// participants it can affect, in stage order, in one bulkWrite.

import mongoose from 'mongoose';

import { AnswerSheet } from '../models';
import { loadRunningOrder } from './rallyOrder';
import { scoreRallySheets } from './rallyScoring';

interface RescoreOptions {
  // Limit the work to these participants. Omit to rescore the whole rally,
  // which is what a change to a stage requires.
  eqs?: number[];
}

// Recompute `totalPenalty` (ORC's + time + merk), the per-row time and merk
// cells and the disqualification flag for a rally, or for just some of its
// participants.
export async function rescoreRally(rallyId: unknown, options: RescoreOptions = {}) {
  // The running order — the routes in their order, and inside a route the
  // creation order of its stages. It is what the time chain is: which start is
  // free, where the delta is neutralised, and which finish disqualifies
  // (app/lib/rallyOrder.ts).
  const { stages } = await loadRunningOrder(rallyId);

  const query: Record<string, unknown> = { rallyId };
  if (options.eqs) {
    // An empty list means there is nothing to do rather than "everything".
    if (options.eqs.length === 0) return;
    // `sanitizeFilter` (app/lib/mongodb.ts) wraps any operator that reaches a
    // filter in `$eq`, which turns this into a cast error. `trusted` is the
    // documented opt-out and is safe here precisely because the backstop is not
    // what makes it safe: these are integers, checked by `Number.isInteger`
    // below and originally by `parseEq`, never a value off the wire.
    query.eq = mongoose.trusted({ $in: options.eqs });
  }

  const sheets = await AnswerSheet.find(query);
  if (sheets.length === 0) return;

  // The computation itself is pure and shared with the offline workspace
  // (app/lib/rallyScoring.ts); this is only the read and the write around it.
  const operations = scoreRallySheets(stages, sheets as any[]).map(({ sheet, score }) => ({
    updateOne: {
      filter: { _id: sheet._id },
      // `revision` is deliberately not touched: it counts the edits an
      // official made, and a re-score is not one (see "Offline mode").
      update: { $set: score },
    },
  }));

  if (operations.length > 0) {
    await AnswerSheet.bulkWrite(operations);
  }
}

// Convenience wrapper for the answer-sheet routes: a sheet write only moves the
// chain of the participants it touched (both the old and the new eq when a sheet
// is renumbered). Non-integers are dropped rather than passed to the query.
export async function rescoreParticipants(rallyId: unknown, eqs: number[]) {
  const unique = Array.from(new Set(eqs.filter((eq) => Number.isInteger(eq))));
  await rescoreRally(rallyId, { eqs: unique });
}
