// Data models for the SARK rally points system.
//
// Structure:
//   Rally  -> the top-level event an admin creates first
//   Stage  -> a rally has many stages; each stage holds an answer key
//   Participant -> optional details of one EQ number in a rally (class, crew).
//   AnswerSheet -> a participant's filled-in sheet for a single stage.
//   CardAccess  -> the code behind the QR a participant scans to pull one
//                  {stage, eq} card into the Android app.
//   User        -> an official's account: a username, a password and one of the
//                  two roles (admin / data-entry).
//                  A participant (eq) can have many answer sheets per rally
//                  (one per stage). The rally winner is decided by the sum of
//                  the penalty points of all of a participant's answer sheets.

import 'server-only';

import mongoose from 'mongoose';

import { CLASSIFICATIONS } from '../lib/participants';
import { MAX_EMAIL_LENGTH, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, ROLES } from '../lib/roles';

// A rally is the top-level event. Stages and answer sheets hang off of it.
const RallySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  // Short public identifier of the rally, e.g. "SARK25". The Android app is
  // handed this as its `rallycode`, shows it as the name of the card in its
  // list and sends it back when a participant finalises a card, so it is how a
  // submission finds its way home. Derived from the name on first use and
  // unique across rallies (see app/lib/appCards.ts); `sparse` because rallies
  // created before the app integration have none until one is generated.
  code: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 32,
    index: { unique: true, sparse: true },
  },
  // Whether this rally's standings are readable with no session, at
  // /public/rallies/[id] (app/api/public/rallies/[id]/results). Off by
  // default — every rally starts private — and an admin's own switch, not a
  // secret: once flipped the rally's own id in the URL is the whole address,
  // handed out as a QR code (see "Public results page" in CLAUDE.md).
  publicResultsEnabled: {
    type: Boolean,
    default: false,
  },
  // The highest `Stage.cardId` handed out in this rally, advanced with `$inc`
  // (ensureStageCardId in app/lib/appCards.ts) so two stages numbered at the
  // same moment can never get the same card number. Unset until the first one
  // is assigned, and seeded from the stages' own numbers then, so a rally that
  // predates it — or a duplicate, whose stages keep their numbers — carries on
  // from where it was.
  cardIdSeq: {
    type: Number,
    min: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// A route is a sequential leg of a rally: every crew rides route 1, then route
// 2, and a route holds several stages. Most rallies have none — a rally with no
// routes is one implicit leg and is ridden, scored and printed exactly as every
// rally was before routes existed (app/lib/routes.ts). The two events a year
// that do have them are re-started at each boundary, which is what a route is
// for: the time delta is neutralised and the next leg's first start is free.
const RouteSchema = new mongoose.Schema({
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  // Place of this route in the rally: 1, 2, 3 … A route, unlike a stage, is
  // reordered by hand — officials swap two legs — so it carries its place rather
  // than leaving it to a timestamp nobody may rewrite. `_id` breaks a tie, so a
  // rally whose routes all read 0 still has one stable order.
  order: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Two routes of one rally may not answer to one name: the printed per-route
// rankings are headed with it. The index is the guard, and the 11000
// duplicate-key error is mapped to a 409 — the same rule as the sheets, the
// participants and the rally code.
RouteSchema.index({ rallyId: 1, name: 1 }, { unique: true });

// A stage belongs to a rally and carries the answer key (score key) used to
// score the participant answer sheets submitted for that stage.
const StageSchema = new mongoose.Schema({
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  // The route (leg) this stage is ridden in, on a rally that has routes. Unset
  // on every stage of the eight rallies in ten that have none: no `routeId` is
  // the one implicit leg the whole app assumed before routes existed, so those
  // rallies store no new field at all. Deliberately not indexed, like `cardId`:
  // every query that reads it is already scoped by `rallyId`.
  routeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Route',
    default: undefined,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  // Stable number of this stage's card within its rally. The running order is
  // the creation order and shifts when a stage is deleted; this number never
  // does, so a card the Android app pulled weeks ago still points at the stage
  // it was issued for. Assigned on first use (app/lib/appCards.ts).
  cardId: {
    type: Number,
    min: 1,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  scoreKey: [{
    rowNumber: Number,
    answers: [String], // Array of up to 4 correct answers for each row
    // Further answers that are equally correct, each one a complete answer for
    // this row: where an appeal is recorded ("both DR and DRR are correct").
    // The row is scored against `answers` and each of these, and costs the
    // lowest of them — see app/lib/scoring.ts. Empty on every key that has one
    // accepted answer, which is all of them until an appeal says otherwise.
    alternativeAnswers: {
      type: [[String]],
      default: undefined
    },
    falseAnswers: [{
      column: Number,
      value: String
    }], // Array of false answers for each column
    maxPenalty: {
      type: Number,
      default: 0
    }, // Maximum penalty points for the row
    // The row's correct letters have to be given in the order of the key.
    // Officials tick this per ORC row; the time and merk columns have no order.
    orderMatters: {
      type: Boolean,
      default: false
    }
  }],
  // Time key of the stage, 10 rows: `ipt` is the ideal passage time of
  // participant 0 — every other participant's ideal time is that plus their eq
  // in minutes. Row 1 is the start, rows 2-9 are the GTC's the stage uses (a
  // row without an `ipt` is not a checkpoint) and row 10 is the finish.
  // `wpt` / `plusMinus` / `maxPenalty` are the officials' pre-refactor
  // reference cells; scoring uses `ipt` and `timeConfig`.
  timeScoreKey: [{
    rowNumber: Number,
    ipt: String,
    wpt: String,
    plusMinus: String,
    maxPenalty: {
      type: Number,
      default: 0
    }
  }],
  // Time-penalty settings of the stage (see app/lib/timeScoring.ts). The
  // defaults are the standard rally limits; `breakMinutes` is the length of the
  // break after this stage and only applies while it is not the last stage.
  timeConfig: {
    breakMinutes: { type: Number, default: 0 },
    gtcEarlyWindow: { type: Number, default: 15 },
    gtcLateWindow: { type: Number, default: 30 },
    finishEarlyWindow: { type: Number, default: 15 },
    finishLateWindow: { type: Number, default: 60 },
    // The GTC's maximum only. The finish is a VTC and has its own, below.
    outOfWindowPenalty: { type: Number, default: 60 },
    // The finish (VTC) passed outside its window. Deliberately without a schema
    // default: a stage keyed before this setting existed stores nothing here,
    // and `resolveTimeConfig` then falls back to that stage's own
    // `outOfWindowPenalty` — what it was scored with — rather than to a default
    // that would re-score it.
    finishOutOfWindowPenalty: { type: Number },
    // True when `finishOutOfWindowPenalty` is the whole cost of a blown VTC (a
    // flat 150 or 180), so the break after the stage is not added on top.
    finishOutOfWindowFlat: { type: Boolean, default: false },
  },
  // Merk key of the stage, 6 rows: one correct letter and one explicitly false
  // letter per row. Every merk row is scored on its own against the key row
  // with the same number (see app/lib/scoring.ts), and `maxPenalty` caps that
  // row.
  merkScoreKey: [{
    rowNumber: Number,
    merk: String,
    // A letter that costs 30 points when it is written on this row, the
    // merk counterpart of an ORC row's falseAnswers.
    falseMerk: String,
    maxPenalty: {
      type: Number,
      default: 0
    }
  }],
  // A crew sometimes runs out of rows mid-stage and switches to a second
  // paper card, continuing their ORC letters as rows 31-60 and their merk
  // letters as rows 7-12 — merk is sightings recorded as the crew goes, the
  // same as the ORC letters, so it grows with the second card too. The time
  // module (10 rows) does not: it is fixed controls the crew passes once
  // regardless of how many answer rows they need, so it is never affected by
  // this flag. See app/lib/validation.ts's ORC_ROWS_PER_CARD/MERK_ROWS_PER_CARD
  // and "Second answer card" in CLAUDE.md.
  usesSecondCard: {
    type: Boolean,
    default: false
  },
});

// A participant of a rally: the crew riding under an EQ number. Optional —
// nothing in the scoring depends on it, an EQ with no record is just an EQ
// nobody named — it records the class the crew rides in and who is in the car.
const ParticipantSchema = new mongoose.Schema({
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  eq: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  // One of the class letters, or '' while the class is still unknown.
  classification: {
    type: String,
    enum: [...CLASSIFICATIONS, ''],
    default: '',
  },
  driverName: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
  },
  navigatorName: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// An EQ number identifies one crew within a rally, so a rally holds at most one
// record per participant. As with the answer sheets, the index is the real
// guard and the 11000 duplicate-key error is mapped to a 409.
ParticipantSchema.index({ rallyId: 1, eq: 1 }, { unique: true });

// An answer sheet is a participant's submission for one stage of a rally.
const AnswerSheetSchema = new mongoose.Schema({
  eq: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stage',
    required: true,
    index: true,
  },
  answers: [{
    rowNumber: Number,
    selectedAnswers: [String], // Array of selected answers (up to 4 per row)
    strafp: {
      type: Number,
      default: 0
    } // ORC penalty points for the row
  }],
  // Time rows, 10 of them. Officials type the `wpt` (the time the participant
  // actually passed the control); `ipt`, `plusMinus` and `strafp` are computed
  // server-side from the stage's time key and stored so the card renders the
  // same numbers the total was built from.
  timePenalties: [{
    rowNumber: Number,
    ipt: String,
    wpt: String,
    plusMinus: String,
    strafp: {
      type: Number,
      default: 0
    },
    outOfWindow: {
      type: Boolean,
      default: false
    },
    // True when the stage uses this control but the sheet has no WPT for it:
    // the participant missed it and was charged its maximum.
    missing: {
      type: Boolean,
      default: false
    },
    // True on the start row of the first stage of a route: the leg begins there,
    // so it is shown but costs nothing and does not move the delta. Stored so a
    // scored card can say so — it is the row an official reads to check that the
    // delta was neutralised at the boundary, and on a rally with routes there is
    // one per route instead of one per rally.
    free: {
      type: Boolean,
      default: false
    }
  }],
  // Merk rows, 6 of them (12 with a second card), of which row 6 is the
  // Diversen row and holds no letter — see `diversenCount`. Officials type only the `merk` letter the participant
  // wrote; `strafp` is computed server-side from the stage's merk key, like the
  // time rows. Every row is scored against its own key row, so a row's `strafp`
  // is what that row cost — its key letter missing (empty or another letter) and
  // the letter it rules out written, 30 each, capped by the row's maximum — and
  // the rows add up to the letter part of `merkPenalty`.
  merkScores: [{
    rowNumber: Number,
    merk: String,
    strafp: {
      type: Number,
      default: 0
    }
  }],
  // The count an official wrote on merk row 6, the Diversen row: how many
  // 30-point fines the crew got (app/lib/scoring.ts). Its points are part of
  // `merkPenalty`, added after the merk cap. 0 on every sheet from before the
  // row existed, which is what the default gives them.
  diversenCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  // Total penalty points for this answer sheet: the ORC's penalty computed from
  // the stage's answer key, plus the time penalty computed from its time key,
  // plus the merk penalty computed from its merk key.
  // Summed across a participant's sheets to rank the rally standings.
  totalPenalty: {
    type: Number,
    default: 0
  },
  // The time part of totalPenalty, kept separately so the card can show the
  // "Tijd" line without recomputing the whole chain.
  timePenalty: {
    type: Number,
    default: 0
  },
  // The merk part of totalPenalty (the "Diversen" line), kept separately for the
  // same reason: it cannot be read off the sheet's rows, because a missing
  // letter is charged to the column rather than to a row.
  merkPenalty: {
    type: Number,
    default: 0
  },
  // The participant missed the finish window of the last stage.
  disqualified: {
    type: Boolean,
    default: false
  },
  // Running time delta (in minutes) carried into and out of this stage. Stored
  // for transparency: the delta of a stage depends on every earlier stage.
  startDelta: {
    type: Number,
    default: 0
  },
  endDelta: {
    type: Number,
    default: 0
  }
});

// A participant fills in at most one sheet per stage.
AnswerSheetSchema.index({ stageId: 1, eq: 1 }, { unique: true });

// The code behind one printed QR: it hands the Android app the card of one
// participant for one stage, and is what the app's submission is checked
// against. One code per {stage, eq}; regenerating a code replaces it, so a
// printed sheet that went astray can be invalidated.
const CardAccessSchema = new mongoose.Schema({
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stage',
    required: true,
    index: true,
  },
  eq: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  // The scannable secret itself: unambiguous upper-case characters only, so a
  // participant whose camera fails can read it off the paper and type it.
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 32,
  },
  // When the app last stored a finalised card through this code. A code accepts
  // one submission: a second one is refused until an official reopens the card,
  // so a guessed rally code cannot overwrite a crew's sheet. Null while the
  // participant has not handed in.
  submittedAt: {
    type: Date,
    default: null,
  },
  // Groundwork for a stage with `usesSecondCard`: which physical card this
  // code stands for. Unused today — every code is minted and resolved as
  // `part: 1` and the unique index below stays `{stageId, eq}` only, so this
  // field changes nothing about how a code is looked up. Wiring a second QR
  // per participant (so the app can scan card 2 as well as card 1) needs the
  // index widened to `{stageId, eq, part}` and new mint/print/submit code —
  // a real migration on a live collection, deliberately not done yet. See
  // "Second answer card" in CLAUDE.md.
  part: {
    type: Number,
    default: 1,
    min: 1,
    max: 2,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// One code per participant per stage — the same shape as the sheets. Not
// `{stageId, eq, part}`: see the comment on `part` above.
CardAccessSchema.index({ stageId: 1, eq: 1 }, { unique: true });


// An account of an official. There are two kinds — an admin runs the rally, a
// data-entry user types cards for it — and what each may do lives in
// `app/lib/roles.ts`, not here.
//
// Participants have no account at all: a crew authorises on the code behind the
// QR they scanned (see CardAccess above).
const UserSchema = new mongoose.Schema({
  // Stored already normalised (lower case, trimmed) by `normalizeUsername`, so
  // the unique index means what it says: "jurian" and "Jurian" are one account.
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: MIN_USERNAME_LENGTH,
    maxlength: MAX_USERNAME_LENGTH,
  },
  role: {
    type: String,
    required: true,
    enum: [...ROLES],
  },
  // Whether this account may sign in. Every account starts active; an admin
  // flips this off to lock an official out without deleting their history or
  // losing the account name to `isEnvAdminUsername`'s guard. `authenticate()`
  // refuses an inactive account exactly like a wrong password, and
  // `currentUser()` refuses it too, so a session open at the moment an admin
  // deactivates it is cut off on its next request rather than surviving to its
  // 24-hour expiry. The environment admin has no document and so is always
  // active — this field is not read for it.
  active: {
    type: Boolean,
    default: true,
  },
  // scrypt, as "<saltHex>:<hashHex>" — the format app/lib/passwords.ts writes
  // and scripts/hash-password.mjs prints. A plaintext password is never stored,
  // here or in the environment.
  passwordHash: {
    type: String,
    required: true,
  },
  // Where a forgot-password link (app/lib/passwordReset.ts) is sent. Optional
  // and `sparse` — an account added before this existed has none until an
  // official fills it in — but unique when set, so one address resolves to one
  // account. Stored already normalised (lower case) by `normalizeEmail`.
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: MAX_EMAIL_LENGTH,
    index: { unique: true, sparse: true },
  },
  // The forgot-password credential in flight, never the token itself — see
  // app/lib/passwordReset.ts for why only the hash is stored. Null once the
  // link is used, expires, or a fresh request overwrites it; also cleared
  // whenever the password changes through any other path, so a stale emailed
  // link cannot outlive the password it was meant to replace.
  resetTokenHash: {
    type: String,
    default: null,
  },
  resetTokenExpiresAt: {
    type: Date,
    default: null,
  },
  // When this account's password was last set. `requireSession()` refuses a
  // token issued before it, so changing (or having an admin reset) a password
  // signs that account's other sessions out.
  passwordChangedAt: {
    type: Date,
    default: Date.now,
  },
  // When and from where this account last signed in successfully. Written by
  // `authenticate()` in app/lib/users.ts on a successful login; the
  // environment admin has no document to write it to, so it stays unset for
  // that account regardless of how often it signs in.
  lastLoginAt: {
    type: Date,
    default: null,
  },
  lastLoginIp: {
    type: String,
    trim: true,
    maxlength: 64,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Create models if they don't already exist
export const Rally = mongoose.models.Rally || mongoose.model('Rally', RallySchema);
export const Route = mongoose.models.Route || mongoose.model('Route', RouteSchema);
export const Stage = mongoose.models.Stage || mongoose.model('Stage', StageSchema);
export const Participant = mongoose.models.Participant ||
  mongoose.model('Participant', ParticipantSchema);
export const AnswerSheet = mongoose.models.AnswerSheet ||
  mongoose.model('AnswerSheet', AnswerSheetSchema);
export const CardAccess = mongoose.models.CardAccess ||
  mongoose.model('CardAccess', CardAccessSchema);
export const User = mongoose.models.User || mongoose.model('User', UserSchema);
