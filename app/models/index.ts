// Data models for the SARK rally points system.
//
// Structure:
//   Rally  -> the top-level event an admin creates first
//   Stage  -> a rally has many stages; each stage holds an answer key
//   Person -> one human being who rides rallies, across every event and every
//             season. Identified by their e-mail address, and the record a
//             crew, a classification and an overall standing all hang off.
//   Season -> the two numbers that decide how one rally year is won.
//   Participant -> the crew registered under one EQ number of one rally: two
//             Persons, the class they ride in and the car they brought.
//   AnswerSheet -> a participant's filled-in sheet for a single stage.
//   CardAccess  -> the code behind the QR a participant scans to pull one
//                  {stage, eq} card into the Android app.
//   User        -> an official's account: a username, a password and one of the
//                  three official roles (admin / data-entry /
//                  classification-admin).
//                  A participant (eq) can have many answer sheets per rally
//                  (one per stage). The rally winner is decided by the sum of
//                  the penalty points of all of a participant's answer sheets.

import 'server-only';

import mongoose from 'mongoose';

import { CLASSIFICATIONS } from '../lib/participants';
import { FUEL_TYPES, MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH } from '../lib/persons';
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  OFFICIAL_ROLES,
} from '../lib/roles';

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
  // The day the rally was ridden. It is what puts a rally in a season — the
  // year is read off this date (app/lib/seasons.ts) rather than stored beside
  // it, because a second field would be a second answer to a question the date
  // already answers.
  //
  // Deliberately not `required`: a rally created before this field existed has
  // none, and the read paths fall back to `createdAt` for it rather than
  // dropping it out of its own year. Every rally created from now on has one —
  // POST /api/rallies demands it.
  date: {
    type: Date,
    index: true,
  },
  // Whether this rally counts towards the overall standings of its year. Some
  // of the ten rallies a year are unofficial — a training run, a rit that did
  // not make the calendar — and those are ridden, typed and scored exactly like
  // any other. They simply do not decide the season.
  //
  // Defaults to true: a rally is official unless somebody says otherwise, which
  // is both the common case and the safe one — an unofficial rally wrongly
  // counted is a wrong champion, and it takes a tick to prevent.
  countsForSeason: {
    type: Boolean,
    default: true,
  },
  // How much this rally is worth in the overall standings, relative to the
  // others: the championship points its finish positions earn are multiplied
  // by this. A long, hard event counts for more than a short one, and the club
  // sets the number per rally. `1` is an ordinary rally, so a rally nobody has
  // weighted is unweighted rather than worthless.
  timeFactor: {
    type: Number,
    default: 1,
    min: 0,
  },
  // True for a rally whose results were **imported** from a historical sheet
  // rather than scored here: the club has years of results on paper, with a
  // finishing order and no strafpunten behind it.
  //
  // Such a rally has no stages and no answer sheets, and the API refuses to
  // give it any (see POST /api/stages and POST /api/answersheets). Two sources
  // of truth for one rally's result is exactly the disagreement this codebase
  // is organised to prevent — its standings are the imported finishing order,
  // read off `Participant.finishPosition`.
  resultsImported: {
    type: Boolean,
    default: false,
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
  // letter per row. The merk column is scored vertically — the column as a whole
  // is compared with the key, not row by row (see app/lib/scoring.ts) — so both
  // letter lists are read as sets over the whole column, and `maxPenalty` is not
  // a row cap: the row maximums are summed into one cap on the whole column.
  merkScoreKey: [{
    rowNumber: Number,
    merk: String,
    // A letter that costs 30 points wherever in the column it is written, the
    // merk counterpart of an ORC row's falseAnswers.
    falseMerk: String,
    maxPenalty: {
      type: Number,
      default: 0
    }
  }],
});

// One human being who rides rallies. The registry the whole participant side
// of this app hangs off: a crew is two of these, a classification belongs to
// one of these, and an overall standing is the same two of these turning up
// together three times.
//
// **The e-mail address is the identity.** It is what an official looks a rider
// up by and what a participant signs in with, and it is the only unique thing
// about a person — two riders share a name often enough that the club has
// stopped being surprised by it. Because the address lives here and nowhere
// else, correcting it is one field on one document and every entry, crew and
// result follows automatically: there is no second copy to update.
//
// A Person is not a `User`. Officials are `User` documents and sign in with a
// username; participants are these and sign in with their address. Keeping them
// apart is what stops an official's account from carrying a food restriction
// and a participant's record from carrying a rally permission.
const PersonSchema = new mongoose.Schema({
  // Stored already normalised (lower case, trimmed) by `normalizeEmail`, so the
  // unique index means what it says: "Jan@Example.com" and "jan@example.com"
  // are one rider.
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: MAX_EMAIL_LENGTH,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  phone: {
    type: String,
    trim: true,
    maxlength: MAX_PHONE_LENGTH,
    default: '',
  },
  // What this rider cannot eat. The club caters the finish, and the answer is
  // free text because "no pork, and my navigator is coeliac" is the shape it
  // actually arrives in.
  foodRestrictions: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  // The class this rider rides in, or '' while it has not been decided. A
  // *crew's* class is derived from its two members' (app/lib/participants.ts)
  // and is never typed in: that is the whole reason the class lives here rather
  // than on the entry.
  classification: {
    type: String,
    enum: [...CLASSIFICATIONS, ''],
    default: '',
  },
  // When the class above was last changed. The head of `classificationHistory`,
  // kept beside it so a list of two hundred riders can show "changed in March"
  // without sending every rider's whole history down the wire.
  classificationChangedAt: {
    type: Date,
    default: null,
  },
  // Every change of the class, oldest first. Written only when the class
  // actually moves — a save that leaves it alone adds nothing — so this reads
  // as what happened to the rider rather than as a log of who pressed Save.
  // It is what answers the question that always follows a promotion: when were
  // they moved up, and by whom.
  classificationHistory: [{
    from: {
      type: String,
      enum: [...CLASSIFICATIONS, ''],
      default: '',
    },
    to: {
      type: String,
      enum: [...CLASSIFICATIONS, ''],
      default: '',
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    // The username of the official who made the change.
    changedBy: {
      type: String,
      trim: true,
      maxlength: MAX_USERNAME_LENGTH,
      default: '',
    },
  }],
  // scrypt, as "<saltHex>:<hashHex>" — the same format a `User`'s password is
  // stored in, verified by the same `app/lib/passwords.ts`. Null for a rider
  // who has no login: most of the entry list, most of the time. A rider without
  // one is still scored, still crewed and still in the overall standings; they
  // simply cannot sign in and look at it themselves.
  passwordHash: {
    type: String,
    default: null,
  },
  // When the password was last set. `requireSession()` refuses a token issued
  // before it, exactly as for an official, so a reset signs the rider's other
  // sessions out.
  passwordChangedAt: {
    type: Date,
    default: null,
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

// The settings of one rally year. There is no "create a season" step — a rally
// with a date in it is the season starting — so a year with no document here is
// read with the defaults in `app/lib/seasons.ts`. A document exists only for a
// year an official has changed something about.
const SeasonSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
    unique: true,
    min: 2000,
    max: 2200,
  },
  // How many of a crew's results are added up: their best N, or 0 for all of
  // them. See app/lib/seasons.ts.
  countingResults: {
    type: Number,
    default: 0,
    min: 0,
  },
  // How many official rallies a pair has to have ridden together before they
  // are placed at all.
  minimumRallies: {
    type: Number,
    default: 3,
    min: 1,
  },
  // What each **band** of finish positions is worth in championship points.
  // The club's table is written in bands — the first five places score their
  // own number, then twos, then threes — so that is the shape it is stored
  // in; `from` and `to` are inclusive and equal on a band of one place.
  //
  // **Empty on a year nobody has configured**, which is read with
  // `DEFAULT_POINTS_TABLE` and shown as such, so a reader knows whether the
  // scale in front of them was chosen for this season or inherited.
  pointsTable: [{
    from: { type: Number, required: true, min: 1 },
    to: { type: Number, required: true, min: 1 },
    points: { type: Number, required: true, min: 0 },
  }],
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// A participant of a rally: the **crew** registered under one EQ number, and
// the car they brought.
//
// A crew is two `Person`s — a driver and a navigator — and the class it rides
// in is the higher of their two classes (`crewClassification`), derived at
// registration rather than typed, so promoting one rider moves every crew they
// are half of. The pairing itself is what an overall standing is grouped on,
// and it is unordered: swapping seats between rallies is the same crew
// (app/lib/crews.ts).
//
// `driverName` / `navigatorName` are **copies** of the two riders' names as
// they stood when the entry was registered, and the one denormalisation in this
// feature. They are what the entry list, the QR sheet, the standings and the
// printed result sheet read, and they are refreshed whenever the person is
// renamed (`PUT /api/persons/[id]`), so the copy cannot go stale while the
// record it came from is edited. The alternative — a join in each of the
// fifteen read paths that show a crew — buys nothing here: the name is what is
// printed, the ids are what is reasoned about, and both are on the row.
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
  // The two riders. Indexed because a rider's dashboard asks "which rallies was
  // I in", which is exactly a query on these.
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Person',
    default: null,
    index: true,
  },
  navigatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Person',
    default: null,
    index: true,
  },
  // Where this crew finished, on a rally whose results were **imported**
  // (`Rally.resultsImported`). Null on a rally scored here, where the position
  // is the rank the rally's own standings give and storing a second copy would
  // be a second place for it to disagree.
  //
  // `0` is not a position: a crew who did not finish has none, and
  // `resultStatus` says which of DNF and DNS they were.
  finishPosition: {
    type: Number,
    default: null,
    min: 1,
  },
  // How an imported result ended: `finished`, `dnf` or `dns`. Null on a rally
  // scored here, where the status is worked out from the cards
  // (app/lib/standings.ts).
  resultStatus: {
    type: String,
    enum: ['finished', 'dnf', 'dns', null],
    default: null,
  },
  // The class the **crew** rides in: the higher of the driver's and the
  // navigator's on B < A < H. Derived and stored at registration, because it is
  // what the rally was ridden and printed under — a promotion in August must
  // not restate what a crew won in March.
  classification: {
    type: String,
    enum: [...CLASSIFICATIONS, ''],
    default: '',
  },
  // Each rider's own class, as it stood on the day. Stored beside the crew's so
  // an entry can be read back without resolving two people whose classes have
  // since moved.
  driverClassification: {
    type: String,
    enum: [...CLASSIFICATIONS, ''],
    default: '',
  },
  navigatorClassification: {
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
  // The car this crew brought to **this** rally. On the entry rather than on a
  // person: a crew turns up in whatever they have that weekend, and last year's
  // entry should keep saying which car actually rode it.
  vehicle: {
    brand: { type: String, trim: true, maxlength: 100, default: '' },
    model: { type: String, trim: true, maxlength: 100, default: '' },
    licensePlate: { type: String, trim: true, maxlength: 32, default: '' },
    fuelType: { type: String, enum: [...FUEL_TYPES, ''], default: '' },
    insurer: { type: String, trim: true, maxlength: 200, default: '' },
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

// A rider may not be entered twice in one rally, in either seat: a person
// cannot be in two cars at once, and counting them twice would give one of
// those "crews" a season it never rode.
//
// **Partial, not sparse**, and the difference is the whole reason this comment
// exists. Both ids are `null` — not absent — on an entry typed straight onto a
// card before anybody registered the riders, and a *sparse* index only skips a
// document where the field is **missing**. It would therefore index every
// unregistered entry under `null` and let the second one in a rally collide
// with the first, which is the common case on an imported entry list.
// `$type: 'objectId'` indexes only the entries that actually name a rider.
ParticipantSchema.index(
  { rallyId: 1, driverId: 1 },
  { unique: true, partialFilterExpression: { driverId: { $type: 'objectId' } } }
);
ParticipantSchema.index(
  { rallyId: 1, navigatorId: 1 },
  { unique: true, partialFilterExpression: { navigatorId: { $type: 'objectId' } } }
);

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
  // Merk rows, 6 of them. Officials type only the `merk` letter the participant
  // wrote; `strafp` is computed server-side from the stage's merk key, like the
  // time rows. The column is scored vertically, so a row's `strafp` is the 30
  // points that row's letter cost as a double or as a false merk — or, on a row
  // left empty, the 30 points of a key letter the column never got, charged
  // there so the column adds up to `merkPenalty` on screen. `merkPenalty` stays
  // the total: it is capped as a column and the rows are not.
  merkScores: [{
    rowNumber: Number,
    merk: String,
    strafp: {
      type: Number,
      default: 0
    }
  }],
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// One code per participant per stage — the same shape as the sheets.
CardAccessSchema.index({ stageId: 1, eq: 1 }, { unique: true });


// An account of an official. There are three kinds — an admin runs the rally, a
// data-entry user types cards for it, a classification admin sets the riders'
// classes — and what each may do lives in `app/lib/roles.ts`, not here.
//
// A participant has no account *here*: they sign in as the `Person` they are,
// with their e-mail address. A crew handing a card in from the Android app
// authorises on neither — the code behind the QR they scanned is the whole
// credential (see CardAccess above).
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
  // An account here is an **official's**. `participant` is deliberately not in
  // this list: a participant is a `Person` and authenticates against that
  // collection, so a `User` holding that role would be an account that can
  // never be what it claims.
  role: {
    type: String,
    required: true,
    enum: [...OFFICIAL_ROLES],
  },
  // scrypt, as "<saltHex>:<hashHex>" — the format app/lib/passwords.ts writes
  // and scripts/hash-password.mjs prints. A plaintext password is never stored,
  // here or in the environment.
  passwordHash: {
    type: String,
    required: true,
  },
  // When this account's password was last set. `requireSession()` refuses a
  // token issued before it, so changing (or having an admin reset) a password
  // signs that account's other sessions out.
  passwordChangedAt: {
    type: Date,
    default: Date.now,
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
export const Person = mongoose.models.Person || mongoose.model('Person', PersonSchema);
export const Season = mongoose.models.Season || mongoose.model('Season', SeasonSchema);
export const Participant = mongoose.models.Participant ||
  mongoose.model('Participant', ParticipantSchema);
export const AnswerSheet = mongoose.models.AnswerSheet ||
  mongoose.model('AnswerSheet', AnswerSheetSchema);
export const CardAccess = mongoose.models.CardAccess ||
  mongoose.model('CardAccess', CardAccessSchema);
export const User = mongoose.models.User || mongoose.model('User', UserSchema);
