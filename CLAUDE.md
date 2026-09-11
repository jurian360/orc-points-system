# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this project is

**SARK Points System** — a web app for scoring **rally events** (SARK-style road
rallies, run by the Surinaamse Auto Rally Klub) on **penalty points**
("strafpunten"). It is a time-speed-distance rally: participants start a minute
apart and have to hold their time schedule.
Officials create a rally, add its stages with the correct answer key and the
stage timetable, then type in each participant's paper control card. The app
grades every sheet — letters and times — and keeps a live rally standing.

Lowest total penalty wins. Points are a penalty, never a reward — nothing in
this system ever subtracts.

Officials can also hand the typing to the crews: every stage has a page of QR
codes, one per participant, that the **Android control-card app**
(`jurian360/android-control-card`) scans to pull that crew's card. A card the
crew finalises comes back here and is scored like any other sheet — see
*The participants' Android app* below.

Stack: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4**, data in
**MongoDB via Mongoose**. Deployed as a single container (see `COOLIFY.md`).

## Domain glossary

The UI is Dutch-flavoured because it mirrors a physical card. Keep these terms
in code and UI — do not "translate" them:

| Term | Meaning |
| --- | --- |
| **Rally** | Top-level event. Has many routes and/or stages. |
| **Route** | A sequential leg of a rally: every crew rides route 1, then route 2, and a route holds several stages. At a boundary the crews are re-started, so the time delta is neutralised. Two events a year use them; **a rally with no routes is one implicit leg** and behaves exactly as every rally did before routes existed. |
| **Stage** | One proef of a rally. Holds the answer key used to grade sheets. |
| **Answer sheet** | One participant's submission for **one** stage. |
| **EQ** | Participant/equipe number, integer `1..100`. Identifies a competitor — crews have no account, only the officials do. |
| **Classification** | The class a crew rides in: `B`, `A`, `H`, `I`, `T`, `N` or `S` (or empty while unknown) — `N` is Nickerie and `S` is Stad, where the crew rides. `CLASSIFICATIONS` in `app/lib/participants.ts` is the one list, and `CLASSIFICATION_LIST` is that list in the sentence a rejected class answers with, so adding a class does not leave four hand-written messages behind. Recorded per participant, not used by the scoring. |
| **Controlekaart** | The paper control card the whole UI is modelled on: 4 columns — ORC's 1–15 \| ORC's 16–30 \| For Official Use Only (time) \| Merk + TOTAAL STRAFPUNTEN. |
| **ORC's** | The 30 lettered answer rows, up to 4 letters (columns) per row. |
| **Strafp. / strafpunten** | Penalty points. |
| **IPT / WPT / +/-** | Time-control columns: ideal passage time, actual passage time and the difference ("delta") in minutes. 10 rows, scored by the app. |
| **IPT 0** | The stage timetable as written for participant 0. Participant `eq` passes `eq` minutes later. |
| **GTC** | "Geheime Tijds Controle" — a secret time control, rows 2-9 of the time column. Participants do not know its ideal time beforehand. A stage uses as many as it needs (2, 4, ...); a row without an IPT 0 is not a checkpoint. |
| **Delta** | How many minutes a participant is off their own schedule. It runs from the start of the rally to the last stage. |
| **Merk** | Marker/sign rows, 6 rows, one letter each. Scored *vertically* against the stage's merk key, which holds the correct letters and the letters it rules out. |
| **Diversen** | The merk part of a sheet's penalty, the third line of TOTAAL STRAFPUNTEN next to ORC's and Tijd. |
| **Admin** | An official who runs the rally: stages, answer keys, entry list, imports, QR codes and the accounts. |
| **Data entry** | An official who types control cards (ORC's, tijd, merk) and reads the standings — nothing else. |
| **Recovery admin** | The admin configured in the deployment environment (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`). No database record, so it cannot be deleted or demoted: the way back in when every admin has forgotten their password. |
| **App code** | The 8-character code behind the QR a participant scans. It stands for exactly one card — one `{rally, stage, eq}` — and is the crew's only credential. |
| **Rally code** | A rally's short public identifier (`Rally.code`), e.g. `SARKNAJAAR`. Officials name it when they create the rally; the app shows it and sends it back with a finalised card. |
| **Card number** | A stage's `cardId`: its stable number within the rally, which a submission is resolved by. Unlike the place in the running order, it does not move when a stage is deleted. |

## Data model (`app/models/index.ts`)

```
User                   (an official's account; owns no rally data)

Rally ──< Stage ──< AnswerSheet
   │        ↑        │  (AnswerSheet also stores rallyId for cheap standings)
   ├──< Route┘       └─< CardAccess   (the QR code of one {stage, eq})
   │      (Stage.routeId, unset on a rally with no routes)
   └──< Participant       (optional details of one EQ: class + crew names)
```

- `Stage.scoreKey` — 30 rows:
  `{ rowNumber, answers[], alternativeAnswers[][], falseAnswers[{column,value}],
  maxPenalty, orderMatters }`.
  `orderMatters` is the officials' "volgorde" tick: the row's letters have to be
  given in the order of the key. Only ORC rows carry it — the time and merk
  columns hold single values and have no order.
  `alternativeAnswers` holds the answers an **appeal** added, each one a
  complete answer for the row rather than an extra letter; empty on every key
  until a jury rules a second answer equally correct.
  `timeScoreKey` (10 rows) holds the stage timetable — `ipt` is the ideal
  passage time of participant 0 — and `timeConfig` its time-penalty settings
  (windows, maximum, break after the stage). `merkScoreKey` (6 rows) holds one
  correct letter (`merk`) and one letter the key rules out (`falseMerk`) per row;
  because the merk check is vertical, both are read as sets over the whole column
  and its `maxPenalty` fields are not row caps — they are summed into one cap on
  the whole column.
- `AnswerSheet` — `{ eq, rallyId, stageId, answers[], timePenalties[], merkScores[],
  totalPenalty, timePenalty, merkPenalty, disqualified, startDelta, endDelta }`.
  **Officials type letters and times, never points.** On an ORC row they type only
  the letters; the row's `strafp` is scored against the stage key. On a time row
  they type only the `wpt`; `ipt`, `plusMinus` and `strafp` are computed
  server-side. On a merk row they type only the `merk` letter; its `strafp` is
  computed too. `parseAnswerRows` / `parseTimePenalties` / `parseMerkScores`
  therefore drop whatever penalty the client sent, and `rescore.ts` writes the
  derived one — a sheet cannot claim a total it did not earn.
- **Unique index `{ stageId, eq }`** — one sheet per participant per stage. The
  pre-insert `findOne` check is a nicety; the index is the real guard, and the
  `11000` duplicate-key error is mapped to a 409.
- `Participant` — `{ rallyId, eq, classification, driverName, navigatorName }`, the
  crew behind an EQ number of one rally. Optional and inert: nothing in the
  scoring reads it, an EQ with sheets but no record is still scored, and a record
  without sheets is listed in the standings as a **DNS** — a crew who was entered
  and never started (see *Finished, DNF and DNS* below).
  **Unique index `{ rallyId, eq }`**; the `11000` duplicate-key error is mapped
  to a 409, same as the sheets. `PUT /api/rallies/[id]/participants/[eq]` upserts
  because a participant usually exists as sheets before anybody types their name;
  `POST /api/rallies/[id]/participants` only creates, so a taken EQ warns instead
  of overwriting another crew. Deleting a participant removes the record *and*
  their sheets in that rally. `POST .../participants/import` writes a whole entry
  list in one `bulkWrite` of upserts — see the import section below.
- `User` — `{ username, role, passwordHash, passwordChangedAt }`, an official's
  account. It hangs off nothing: an account owns no rally data, so deleting one
  cascades nothing and the sheets it typed stay where they are. The username is
  stored already lower-cased (`normalizeUsername`) so the **unique index** means
  what it says, and `passwordHash` never leaves the API — every user route
  projects `username role passwordChangedAt createdAt`. See *Accounts and roles*
  below.
- `CardAccess` — `{ rallyId, stageId, eq, code, submittedAt }`, the code behind
  one printed QR. Minted per `{stage, eq}` (**unique index**), never derived, so
  it cannot be guessed from an EQ number. `submittedAt` is the hand-in lock: a
  code stores one card, and a second submission is refused until an official
  reopens it. See the Android app section below.
- `Rally.code` and `Stage.cardId` are what a submission from the app is resolved
  by. A rally gets its code when an official creates it — they type it, starting
  from a suggestion derived from the name (`app/lib/rallyCodes.ts`, pure and
  shared with the browser so the form and the server agree). `Stage.cardId`, and
  the code of a rally that pre-dates this, are generated on first use
  (`app/lib/appCards.ts`), so an older rally gets one the moment its first QR
  code is printed. Both `POST /api/rallies` and `PUT /api/rallies/[id]` map the
  unique index's `11000` to a 409: two rallies answering to one code would make
  a submission ambiguous. A `PUT` that sends no `code` keeps the stored one —
  a rally without a code cannot be scanned into the app at all.
- `Rally.publicResultsEnabled` — off by default, an admin's own switch
  (`PUT /api/rallies/[id]/public-results`) for whether `/public/rallies/[id]`
  answers with no session at all. See *Public results page* below.
- `totalPenalty` is **denormalised** on the sheet: the ORC's penalty plus the
  time penalty plus the merk penalty, computed server-side at write time.
  Standings read this field.
  Re-scoring goes through `app/lib/rescore.ts` (`rescoreRally` /
  `rescoreParticipants`, one `bulkWrite`) because the time part is a chain — see
  the scoring rules below.
- `Route` — `{ rallyId, name, order, createdAt }`, a sequential leg of a rally.
  **Unique index `{rallyId, name}`** (the printed per-route rankings are headed
  with it); the `11000` is mapped to a 409, like the rally code. `order` is an
  explicit field rather than `createdAt`, because a route — unlike a stage — is
  reordered by hand, and a creation timestamp that officials rewrite stops
  meaning anything. `Stage.routeId` puts a stage in one and is **unset** on
  every stage of the eight rallies in ten that have no routes, so those store no
  new field at all.
- The **running order** of a rally (`app/lib/routes.ts`, pure and shared;
  `app/lib/rallyOrder.ts`, the query) is: if the rally has **no routes**, its
  stages by `(createdAt, _id)` — the order it always was. If it **has routes**,
  its routes by `(order, _id)` and inside each route its stages by
  `(createdAt, _id)`. Everything positional is asked of that one helper rather
  than of an array index, and it used to be a `{createdAt:1,_id:1}` sort written
  out in seven files.
  A stage whose `routeId` is absent or names a route of another rally sorts
  **ahead** of every route, as a leading leg of its own. The API does not allow
  one, but a document edited straight in the database can produce one, and
  sorting it *last* would make its finish the rally's finish — the real last
  stage would stop disqualifying and every crew who missed it would silently
  read as having finished.
- **"The last stage" is two questions now**, and they used to be one flag
  (`isFinalStage`): `endsRoute` — nothing of the same route follows, so the break
  after the stage is not charged with its finish — and `endsRally`, the last
  stage of the last route, the one finish in the whole rally that disqualifies.
  On a rally with no routes they are the same stage and the same answer.

## Routes: the legs of a rally (`app/lib/routes.ts`)

Two of the ten rallies a year are ridden in **separate legs**: the crews ride
route 1, then route 2, and at the boundary they are re-started on a fresh
schedule. A route holds several stages.

**A rally with no routes is one implicit leg holding every stage.** That is not a
special case bolted on the side — it is what makes the other eight rallies
byte-identical, because every derived flag collapses to the value it had before.
`groupStagesByRoute` returns `[]` for such a rally, which is the gate every view
uses: `routes.length === 0` means "render exactly what you rendered before", not
"render a group of one".

- `app/lib/routes.ts` is **pure and shared, client + server**, like
  `standings.ts` and `participants.ts`: the scoring, the standings route, the
  entry form's live preview and the printed sheet all have to answer "which leg
  is this stage in" the same way, and a second implementation is a second answer.
  It holds `orderStagesByRoute`, `groupStagesByRoute`, `legPositions` (the
  boundary flags), `stageLegPosition` and `routeTotals`.
- `app/lib/rallyOrder.ts` is `server-only` and is only the query
  (`loadRunningOrder`). It appends `routeId createdAt` to any projection it is
  given, because a projection that left them out would silently collapse a rally
  into one leg in creation order.
- **The boundary flags are adjacency on `routeId` over an already-ordered list.**
  That precondition is the function's contract and `orderStagesByRoute` is its
  only producer; a list that is not grouped reads as more legs than the rally
  has. It is checked nowhere on purpose — this runs in a browser render path, and
  an exception there would take a page down over a data problem a re-score fixes.
- **A crew's per-route totals are derived, never stored** (`routeTotals`, summed
  from the `stagePenalties` the standings already return). A second copy of a
  number is a second place for it to disagree, and it is the same reason the
  printed sheet re-ranks the per-class results where it prints them instead of
  asking the API for a second ranking.
- **The routes API** is rally-scoped (`/api/rallies/[id]/routes`, and
  `.../[routeId]` for a rename or a delete), `requireSession()` to read and
  `requireRallyAdmin()` to write — a leg boundary moves the delta of the whole
  field. No new `Permission`. A route of another rally answers **404** at that
  path, not 403.
- **A rally has one of two shapes and never a third**: no routes at all, or
  routes with every stage in one of them. Creating the **first** route takes
  every stage the rally already has (that leg is what its stages were typed as);
  a stage created while routes exist has to name one (400 otherwise); and
  **a route that still holds stages cannot be deleted** — 409, naming them.
  Deleting a stage takes its answer sheets with it, and a mis-click on a
  *grouping* must never be able to do that. Deleting the last route puts the
  rally back to one implicit leg.
- **Everything that moves a leg boundary re-scores the rally** — creating a
  route, reordering them, deleting one, and moving a stage between them (a
  `routeId` on `PUT /api/stages/[id]`, which is opt-in the way a rally's code is:
  a body without it leaves the stored value alone). Renaming a route is the one
  write that does not, a name being no part of the chain.
- **Route management lives in the dashboard's Stages tab**, not on a page of its
  own, so `middleware.ts`'s `RESTRICTED_PAGES` gains nothing: the dashboard is
  deliberately not restricted, a data-entry official reads it. The panel is
  gated on `manage:rally` in the component *and* every route it calls is guarded
  — hiding a button is never the control.

## Scoring rules (`app/lib/scoring.ts`)

`PENALTY_PER_ERROR = 30`. Per ORC row, against that row's key:

1. Each letter the row's `falseAnswers` rules out → **+30**, but a letter costs
   that only as often as the key lists it: a key that rules out `D` charges 30
   whether the participant wrote one `D` or four, and a key that rules `D` out
   in two columns can charge 60. Writing the same wrong letter again is the
   same mistake, exactly as in the merk column.
2. Each correct letter given **more often than the key asks for** → **+30**,
   once per letter: `R D R D` on the key `R D` costs 60 — one error for the
   extra `R` and one for the extra `D` — while `R R R` on that key costs 30
   for the doubled `R` (plus 30 for the missing `D`), because writing the
   same surplus letter again is the same mistake, exactly as in the merk
   column.
3. Each required correct letter **missing** → **+30**.
4. On a row with `orderMatters`, the correct letters given **out of the key's
   order** → **+30**, once, on top of what the letters themselves cost.
5. The row total is then **capped at `maxPenalty`** when `maxPenalty > 0`
   (`0` / undefined means no cap).

A row can accept **more than one answer**. After a rally, participants may
appeal a key, and the sport's rules answer an upheld appeal by accepting both
the original answer and the appealed one — `DR` and `DRR` are then equally
right. Officials record the second answer in `alternativeAnswers` (the `+` next
to the row number on the stage form); rules 1-4 are then run against **every**
accepted answer and the participant is charged the **cheapest** result, capped
after the fact by rule 5. So both answers cost nothing and a wrong card is
measured against whichever accepted answer it came closest to: on `DR` with
`DRR` added, `D` costs 30 (missing R), `DRRR` costs 30 (extra R), `R` and `RR`
cost 30 (missing D), `RRR` costs 60 and an empty row costs 60. The false letters
and the cap belong to the row, not to one of its answers, so they cost the same
against each variant and never decide which one wins. `matchedAnswerVariant`
reports the answer a row was scored against — `OrcAnswerGrid` colours the card's
letters against it, so a cell of a free card is never left uncoloured.

The **key** decides which rows are scored, never the sheet. A row the
participant did not answer costs its missing letters whether the sheet holds a
blank row for it or holds no row for it at all — a sheet with no `answers` (the
one a time import creates) is a card nobody has typed yet and scores as an empty
card, not as a stage without questions. A key row with no letters of its own
still costs nothing, so the ORC rows a stage does not use stay free. This is what
keeps `rescoreRally` and a re-saved sheet — the same computation — from
disagreeing.

The order rule (rule 4) reads the letters left to right, ignores the ones that
are not in the key, and asks whether what is left is a **subsequence** of the
key — for the key `BAC`, `BC` and `AC` are in order, `CA` and `AB` are not. It
never fires when it cannot tell: a key of one letter has no order, and **one
correct letter given is never out of order**. So on the key `NW`: `WN` costs 30
for the order, `N` alone costs 30 for the missing `W` and nothing more, and on
the key `BAC` both `CA` and `AB` cost 60 — 30 for the missing letter and 30 for
the order, because two letters do show an order.

Sheet total = ORC's rows + the stage's time penalty + the stage's merk penalty.
Rally total = sum of a participant's sheet totals **plus a blank card for every
stage they have no sheet for** (see below); standings sort ascending, ties
broken by EQ, with the crews who did not finish and the ones who did not start
behind them (see *Finished, DNF and DNS*). A standings entry carries the
three parts as well (`orcPenalty` / `timePenalty` / `merkPenalty`, the ORC's part
being the stored total minus the stored time and merk parts), so the table shows
an ORC's, a Tijd, a Diversen and a Total column.

This module is shared by the API and the React views on purpose: the scoring
detail must agree with the stored total. **If you change a rule, change it
here only** — never re-implement scoring in a component or a route.

## A stage with no sheet (`app/lib/missingSheets.ts`)

A crew who handed in one card of three was not scored on the other two, so
leaving those stages out would put them ahead of the whole field on a third of
the points. **A stage a participant has no sheet for is scored as a blank card**
— the numbers they would have got by handing that card in with nothing written
on it. `blankSheetPenalties` is the whole rule, and it re-implements nothing: it
calls the three functions a real sheet is scored by, with nothing to score.

- **The ORC's**: `calculateTotalPenalty(scoreKey, [])`. The key decides which
  rows are scored, so every letter of the key counts as missing and the rows the
  stage does not use stay free.
- **The time column**: `scoreStageTimes` with no entries. Every control the
  stage uses is one the participant missed — a GTC costs its flat maximum, the
  finish the VTC's maximum plus the break after the stage — and the start
  costs nothing, because it has no window. A missed control never moves the
  delta, so a stage nobody typed does not disturb the chain of the stages
  around it. Neither the crew's EQ nor the delta they carry in changes any of
  this, so a stage's blank card is scored once and costs every crew the same.
- **The merk column**: `calculateMerkPenalty(merkScoreKey, [])`, an untyped
  column — every letter of the key missing.
- So it is exactly the total a stage's sheet would hold if an official opened it
  in the form and saved it untouched, and exactly what the empty sheet a time
  import creates already scores. The letters the key *rules out* are not
  charged: a blank card never wrote them.
- **Nothing is stored**: a sheet that does not exist has no row to write points
  on. The numbers are added where the rally is added up — the standings route
  (`stagePenalties[stageId]` with `missingSheet: true`, counted in
  `totalPenalty` and in the three parts) — and `ParticipantAnswersView` shows
  the same ones on the stage it lists as missing, so the card page and the
  standings show one total. A stage with no sheet is not re-scored and does not
  re-score: `rescore.ts` writes sheets, and there is none.
- **The sheet's `disqualified` flag stays a card's business.** A missing sheet
  never sets it — only the finish of the last stage of the last route does, on a
  card (`app/lib/timeScoring.ts`). Missing that stage's card is still not
  finishing the rally, and that is `status: 'dnf'` on the standings entry, not a
  flag on a sheet that does not exist (see below).
- A crew with **no sheets at all** is a DNS (below) and is scored on every stage
  of the rally as a blank card, which is the same rule with nothing left over.

## Finished, DNF and DNS (`app/lib/standings.ts`)

A result sheet has three groups, and `status` on a standings entry says which
one a crew is in. The type, the order they are ranked in and the labels are one
pure module, shared client + server, so the screen and the paper cannot
disagree:

| `status` | Who | Where |
| --- | --- | --- |
| `finished` | Rode the rally and came in | Ranked 1, 2, 3 on points |
| `dnf` | Started but did not finish | Behind the field; prints **DNF** instead of a place |
| `dns` | Did not start | Behind the DNF's; prints **DNS** |

- **DNF is two things at once**: the card of the last stage of the last route
  puts the crew outside its finish window or holds no finish time at all
  (`disqualified` on the sheet, see the time rules), **or** the crew has no card
  for that stage at all. Either way they did not finish the rally. The rule did
  not change when routes arrived — only the order it is read off did, because
  the last stage of the running order *is* the last stage of the last route. Their points stand and are printed as they
  stand — the place column says what happened, the numbers say what they scored.
- **DNS is a crew on the entry list with no card in the whole rally.** They used
  to be left out of the standings; they are listed now, because a crew who was
  entered and did not come to the start belongs on the result sheet as a DNS
  rather than nowhere. Every stage of theirs is missing, so the rule above
  scores them a blank card for the whole rally.
- A crew who missed a **middle** stage but has the last stage's card finished the
  rally: they are ranked, with that stage scored as a blank card.
- Only a `finished` crew has a place. The dashboard's rank column and the
  printed sheet's place column show `STATUS_LABEL` instead for the other two,
  and the rally header counts the crews that have a card, not the DNS's.
- **The same three groups are read per route** on the printed route sheets
  (`routeTotals` in `app/lib/routes.ts`) — a *reading* of this one rule, not a
  fourth status. No card on the leg at all is a DNS for it; a card somewhere in
  the route with a hole where its last stage should be is a DNF for it; and
  `disqualified` counts **only on the last route**, because inside the rally a
  blown finish is a penalty and the crew rode on. Printing a crew DNF for route
  1 because they blew its last finish is a judgement the sport does not make.

## Time scoring rules (`app/lib/timeScoring.ts`)

`PENALTY_PER_MINUTE = 1`. A stage's time column has 10 rows: row 1 is the
**start**, rows 2-9 are the **GTC's** it uses, row 10 is the **finish**. The key
holds the ideal time of participant 0, so `IPT(eq, row) = IPT0(row) + eq`
minutes. Officials type the WPT; the delta is `WPT - IPT` in minutes.

1. The delta starts at **0** at the start of every **route** and **carries from
   stage to stage** inside it. A rally with no routes is one route holding every
   stage, so there it starts at 0 once and runs to the last stage — which is what
   this file always described.
2. The **start of the first stage of a route is free**: it is where the leg
   begins, so it costs nothing and does not move the delta — a participant sent
   away late does not get to keep that as their delta. The start of every later
   stage of the same route *is* scored (it has no window), so a participant who
   carries `+3` and starts the next stage on time pays those 3 points.
   **The reset needs both halves and only one of them is obvious.** The free start
   row returns without assigning `runningDelta`, so setting the flag alone would
   leave the carry-over in place and charge it at the next GTC; passing
   `startDelta: 0` alone would charge it at the start row itself. Both fire at
   index 0 on a rally with no routes, where the delta is already zero, which is
   why they never had to be told apart.
3. A control costs **1 point per minute the delta moved** since the previous
   control — arriving `+5` costs 5, then dropping back to `+3` costs 2 more.
   Participants have to *keep* their delta, not undo it.
4. A **GTC outside its window** (default 15 early / 30 late) costs a flat
   maximum (`outOfWindowPenalty`, default 60) and **never moves the delta**: it
   reverts to the last valid one, so the next control is measured against that.
   It is the **GTC's** maximum only — the finish is a VTC and has its own.
5. The **finish is a VTC** — a *verplichte* control, not a secret one — so a
   blown finish window costs `finishOutOfWindowPenalty`, not the GTC's maximum.
   The sport's usual is that maximum **plus the break after the stage**
   (`timeConfig.breakMinutes`, which differs per stage), and some events instead
   fine a blown VTC one flat amount (150, 180) that is the whole cost:
   `finishOutOfWindowFlat` is that, and it means the break is already in the
   number. Either way it leaves the delta at the last valid one, like any blown
   window, and the finish of a stage that **ends its route** carries no break at
   all: the next leg re-starts the crew anyway, so there is nothing to carry
   into it. **A stage that stores no `finishOutOfWindowPenalty` falls back to
   its own `outOfWindowPenalty`** — what it was scored with before the VTC had a
   maximum of its own — so adding this setting re-scored nothing. Falling back
   to the *default* 60 instead would have moved every stage keyed with other
   limits, which is why the fallback is in `resolveTimeConfig` and in
   `parseTimeConfig` rather than a schema default.
6. The **finish of the last stage of the last route** has a wider window
   (default 15 early / 60
   late); outside it the participant is **disqualified** (`disqualified` on the
   sheet; standings rank them behind everyone else). So is a participant with no
   finish time at all on that stage — a DNF, see the next rule.
7. A row with no IPT 0 is not a checkpoint of that stage. A checkpoint that *is*
   used but has no WPT is one the participant **missed**, and **missing a
   control is blowing it**: it costs exactly what passing it outside its window
   costs — the GTC's maximum for a GTC, the VTC's for the finish, the break and
   the flat rule included. A crew who never came through a control did not keep
   their time there any more than one who came through an hour late, and the
   sport does not price the two differently; the finish had a separate
   `missingFinishPenalty` until officials pointed that out. Like a blown window
   it **never moves the delta**, and the row is still *marked* `missing` on the
   sheet so the card and the WPT overview show `gemist` in red — the same
   points, but an official can see that no time was recorded rather than one
   that was too late. A missed finish on the **last** stage is a **DNF**: the
   participant never finished the rally, so they are disqualified as well as
   charged.
8. The **start row has no window, so it has no maximum either**: an untimed start
   costs nothing and leaves the delta where it was. The start of the first stage
   is free in any case.

Windows, the two maximums and the break live in `Stage.timeConfig` so an event
can be run with different limits; `DEFAULT_TIME_CONFIG` holds the standard ones.
**The maximums are split by control and by nothing else**: `outOfWindowPenalty`
is the GTC's and `finishOutOfWindowPenalty` is the VTC's, each covering both ways
of losing that control — blown and missed. Splitting them by *what went wrong*
instead is what produced a `missingFinishPenalty` that priced a missed finish
differently from a blown one, which is not a distinction the sport makes.
`finishOutOfWindowCost` is the one place that reads a VTC's cost — the scoring,
the missed-control branch and the stage form's maximum overview all call it, so
they cannot read the flat flag differently.

## Merk scoring rules (`app/lib/scoring.ts`)

The merk column is the second lettered check of a stage: 6 rows, **one letter per
row**, and it is scored **vertically** — the column as a whole is compared with
the stage's `merkScoreKey`, so which row a letter was written on and in what
order do not matter. A key row holds the correct letter *and* a letter the key
rules out (`falseMerk`, the merk counterpart of an ORC row's `falseAnswers`);
because the check is vertical, both lists count for the whole column, not for the
row they were typed on. Three things cost 30 points, and no letter can cost them
more than once:

1. a key letter given **fewer** times than the key asks for (a missing letter);
2. a key letter given **more** times than the key asks for (a double);
3. a letter the key **rules out**, however often it is written.

A letter in **neither list** is ignored, however often it is written — the key
decides what is scored here, exactly as it does for the ORC rows. A letter in
*both* lists is a key that contradicts itself: the correct list wins, so a
participant is never charged for writing what the key asked for. Against the key
`A A C` with `B` ruled out:

| Given | Costs | Why |
| --- | --- | --- |
| `A C` | 30 | one `A` missing |
| `A A C C` | 30 | `C` doubled |
| `B A A C` | 30 | `B` is ruled out by the key |
| `B B A A C` | 30 | still one `B` — never twice for the same letter |
| `D A A C` | 0 | `D` is in neither list |
| `A A A C` | 30 | `A` doubled |
| `A A A C A` | 30 | still one double of `A` — never twice for the same letter |

The column total is capped at the sum of the key rows' `maxPenalty` when that sum
is > 0 (the merk check has no rows of its own to cap). A sheet with no merk rows
is an untyped column, not an unscored one: every letter of the key counts as
missing, the same as the blank card it stands for.

The merk penalty is the **Diversen** line of TOTAAL STRAFPUNTEN and **is** part
of `totalPenalty` and of the standings. It is stored on the sheet as
`merkPenalty`. A row's `strafp` carries the 30 points that row's letter cost as a
double or as a ruled-out letter; a *missing* letter belongs to no row, so it is
charged to an **empty** row — the key row that asks for it when that row is still
empty, otherwise the first empty row of the column — and shown there (`status:
'missing'`, with the letter in `missingMerk`) so the column adds up to what it
costs instead of reading 0 on every row. A column with no empty row left keeps
those points in `merkPenalty` only, as does the cap: the cap is on the column,
the rows are not capped. `calculateMerkPenalty` therefore returns a row per row
of the sheet **and** per row of the key, so a key row a sheet never got is still
a row of the column.

Because the delta chains, **a sheet cannot be scored on its own**: writing a
sheet re-scores that participant's whole rally (`rescoreParticipants`), and
adding, editing or deleting a stage re-scores every participant (`rescoreRally`),
since it also moves which stage is last.

`POST /api/rallies/[id]/rescore` (the *Recalculate Scores* button on the rally
dashboard) runs `rescoreRally` over a whole rally on demand. The write paths
above already keep the standings correct, so this is for what happens outside
them: a scoring rule that shipped after the cards were typed, or a document
edited straight in the database. It takes no body — the rally in the path is the
whole request.

## Importing an entry list

Officials do not type 50 crews by hand: `ParticipantsPanel` → *Import Entry List*
reads the organisation's own spreadsheet.

- **The file is parsed in the browser** (`app/lib/spreadsheet.ts`): an .xlsx is a
  ZIP of XML, inflated with `DecompressionStream('deflate-raw')` and read with
  `DOMParser`, so there is no parser dependency and no file-upload route. CSV is
  supported as the way out of a workbook that cannot be read. Only the four
  mapped values per crew are POSTed as ordinary JSON, which keeps the API behind
  `readBody`'s 256 KB object-only guard — 56 crews is about 5 KB.
- **Columns are guessed, not fixed** (`app/lib/participantImport.ts`): these
  sheets are exported for the entry system (the reference file has 28 columns,
  `Equipe` / `EqKlasse` / `bNaam` (driver, "bestuurder") / `nNaam` (navigator)),
  so the header row and the four columns are detected by name and then shown in
  selects the official can correct. Rows are validated for the preview with the
  same rules the API applies, and the bad ones are listed with their line number
  instead of being dropped silently.
- **The import route re-validates everything** and is all-or-nothing: one bad row
  rejects the request, because a half-imported entry list is worse than none.
  Rows upsert on `{rallyId, eq}`, so re-importing a corrected sheet updates the
  crews. Nothing is re-scored — a participant record carries no points.

## Importing the times of a control

A GTC does not hand in a card, it hands in its own export — the reference files
carry `rallycode, gtc, eq, wpt, mod-wpt, comment`, one line per participant
number, always the full 1..100 even though only the crews that passed have a
time. `/time-import` (`TimeImportWizard`) reads that file into **one row** of one
stage's time column.

- **Four steps, because the file says nothing about where it belongs**: rally,
  stage, which of the 10 time rows (START / GTC 1-8 / FINISH, each shown with its
  IPT 0), then the file and its columns. Opening it from a rally or a stage
  pre-selects those (`/time-import?rallyId=…&stageId=…`).
- **The rally needs its entry list first.** A time is imported for a *crew*: an
  EQ with no `Participant` record rejects the import rather than inventing one.
  A participant who has no sheet for the stage yet gets one holding only this
  time (`createMissingSheets`, on by default); its `answers` stay empty until an
  official types the card, and an empty card scores every letter of the key as
  missing — the same as opening that sheet in the form and saving it untouched.
- **Reading and mapping are shared with the entry-list import**:
  `app/lib/spreadsheet.ts` for the file, `app/lib/columnMapping.ts` for guessing
  the header row and the columns, `app/lib/timeImport.ts` for what each line
  means. Only `{eq, wpt}` per crew is POSTed. A `.xlsx` time cell arrives as a
  fraction of a day (19:27 is `0.81041666…`) and is read as one; `19.27` stays a
  clock time.
- **A line without a time is skipped, never cleared**: the export lists every
  number, and an import only fills times in. An optional control column filters a
  file that holds more than one control, and a file that names control 2 while
  GTC 1 is selected says so before anything is written.
- `POST /api/stages/[id]/times/import` re-validates everything (`parseEq`,
  `parseWpt`, `parseTimeRowNumber`), writes the WPT's in one `bulkWrite` and then
  calls `rescoreParticipants`: it stores no `ipt`, `plusMinus` or `strafp` of its
  own, exactly like the answer-sheet routes.

## The WPT overview

The rally dashboard has four tabs — Stages, Standings, Participants and **Times**
— and the last one is the time import read back. `RallyTimesPanel` shows **one
row per crew** running the whole rally left to right: the stages sit side by
side in running order, each with a column per control (START, the GTC's the
stage uses, FINISH) and its own Tijd total. It is what an official reads once a
control has handed its export in — did every crew get a time, and which of them
came in outside their window — instead of opening 56 cards.

- **It is a grid, not a page of tables**, and it is laid out as one: the grid
  scrolls inside itself in both directions with the crew columns and the two
  header rows frozen. It does *not* get a width of its own — the dashboard, its
  header and all four tabs share `PAGE_CONTAINER` (`app/lib/layout.ts`), so
  switching to this tab does not re-flow the page; a grid wider than that
  scrolls, which is what it does at any width anyway. On a real rally it is 56 crews long and a dozen controls
  wide, and neither the name of a crew nor the name of a control may scroll out
  of sight. Two consequences to keep: the table is `border-separate`, because a
  sticky cell loses collapsed borders, and the three crew columns have **exact**
  widths, because each one is frozen at the sum of the widths before it —
  changing a width means changing the offset after it.

- **A card shows one crew's time column; this is the other way round.** Both are
  the same numbers: `GET /api/rallies/[id]/times` reads the `timePenalties` rows
  the sheets already carry (written by `app/lib/rescore.ts`) and scores nothing
  of its own, so the overview and the controlekaart cannot disagree. Correcting a
  time still means correcting the sheet or importing the control again.
- **The key decides the columns**, exactly as it decides the scored rows: a stage
  gets a column per row with an IPT 0, headed with that IPT 0 (every crew's own
  ideal time is it plus their EQ). One exception, deliberate: a row that has no
  IPT 0 but *does* hold an imported WPT gets a column too, in amber — a time on a
  row the stage does not use is the mistake this page exists to show.
- A red time was outside its window, `gemist` is a control the crew has no time
  for at all, and a row with no sheet at all reads as dashes. Every cell can show
  the ⁺∕₋, the crew's IPT or the strafpunten under the WPT; the last column is the
  stage's stored `timePenalty`.
- The response shape lives in `app/types/index.ts` (`RallyTimes`), read by both
  the route and the panel. It is a **read**, so its guard is `requireSession()`:
  a data-entry official types the cards and checks the times of the control they
  are typing from.

## Printing the standings

The standings tab is the whole field in one table, which is what an official
reads on a screen. What goes on the wall at the finish is a **result sheet**:
`/rallies/[id]/standings/print` (the *Print* button next to the standings
filters) lays the same numbers out on A4, in one of four shapes — the last only
on a rally ridden in routes.

- **Algemeen klassement** — every class together in one ranking, the whole field
  on one sheet. The place is the API's own rank, so this sheet *is* the standings
  tab on paper. Like the wedstrijdklasse it carries a **Kl.** column, because a
  reader cannot tell a crew's class from the heading when the classes are mixed.
- **Per class** — one A4 per classification, each with its own 1, 2, 3, because
  a class rides against its own class. The page filters the ranked standings and
  re-numbers what is left; the order itself is still the API's (the crews who
  finished first, then the DNF's, then the DNS's, each on total and then on EQ),
  so no sheet can disagree with the screen.
  A single class can be printed on its own.
- **Wedstrijdklasse** — the classes that ride one competition, `A` and `H`, on
  one sheet with its own 1, 2, 3. It is not a class a crew is entered in:
  `WEDSTRIJDKLASSE_CLASSES` in `app/lib/participants.ts` says which classes it
  reads together, `CLASSIFICATIONS` deliberately does not hold it, and nothing
  outside the printed results knows about it. A crew of those classes is printed
  twice — on their own class sheet and on this one — because they are placed in
  both, and it carries a **Kl.** column for the same reason the combined sheet
  does. *Per class* prints it first, ahead of the class sheets it combines; it
  can also be printed on its own (`?view=wedstrijd`), and no crews in either
  class means no sheet.
- **Per route** — on a rally ridden in legs, one A4 per route with its own 1, 2,
  3, ranked on what that leg alone cost a crew. A route is ridden by everybody,
  so it gets a ranking of its own the way a class does; the rally is read on the
  algemeen klassement and the leg on these. The route's numbers are written onto
  the copied entry *as* its totals, the way a class sheet writes `placing`, so
  the table prints a route sheet with no new rendering code and the DNF/DNS label
  lands in the place column on its own. Its order is the standings' own
  comparator read over the route's numbers (status, then points, then EQ) — the
  first sheet on the page whose order is not the API's, because a rally rank says
  nothing about one leg. Addressed as `?route=<id>` (or `?route=all`), and a
  `route:<id>` `PrintMode`: a 24-character hex id cannot collide with a class
  letter or with any of the words.
- **It scores nothing.** It is `GET /api/rallies/[id]/standings` read onto paper,
  like `RallyTimesPanel` is for the times, and its guard is that route's
  `requireSession()`: reading the standings is a data-entry official's too, so
  the page is not in `RESTRICTED_PAGES`.
- The columns are the result-sheet ones: # (the place), EQ, (Kl.,) Navigator, Bestuurder
  and the four numbers (ORC's, Tijd, Div., Totaal). The Kl. column is on the
  combined and the wedstrijdklasse sheet only. Navigator and driver get a
  column each here rather than the dashboard's `crewLabel` string, so the names
  line up down the page. A name too long for its column **wraps** onto a second
  line: a crew's name is the one thing on a result sheet that may not be cut
  off, so it costs a taller row rather than an ellipsis.
- **A rally of more than one stage prints those four numbers per stage too**, in
  running order and headed with the stage's name, ahead of the rally total: a
  crew reads where in the rally they lost their points, not only how many. One
  stage means the stage total *is* the rally total, so that sheet keeps the
  plain four columns instead of printing everything twice. The per-stage numbers
  come from the standings route, which now returns the rally's `stages` in
  running order and a `stagePenalties` record per entry (keyed by stage id, the
  same three parts as the totals, taken from that one sheet) — so the sheet
  still scores nothing. A stage a crew has no sheet for carries that stage's
  blank card (`missingSheet`), which the standings charge them, so it is printed
  like any other stage with a `*` and a footnote under the table. More stages make the per-stage columns narrower and
  smaller (`stageSizing`) rather than pushing a stage off the sheet.
- **A rally ridden in legs prints the per-stage sheet with the legs written over
  it**: the four numbers per stage, the stages grouped under the route they are
  ridden in, and the rally total behind them. Three header rows — route, stage,
  the numbers.
  **It carries no route subtotal.** A leg's total is its stages added up, and an
  official reading the sheet wants the proeven; the leg's own number is what the
  per-route ranking sheets rank on, which is where it is the point. Leaving it
  off also keeps the sheet exactly as wide as the per-stage sheet — `4 × stages +
  4` numeric columns either way — so **`stageSizing` sizes both** and the routes
  cost a header row rather than a column. That is why there is no fit test and no
  per-stage toggle on this sheet: there is no narrower shape to fall back to.
  The `<colgroup>`, the three header rows and the body all take a leg's width
  from **`routeColumns(group)`** rather than restating the arithmetic: a header
  row that does not add up is what shears a printed table sideways.
- On a routed sheet the rally total is headed **`ORC` … `Tot.`**, so every group
  on the sheet reads the same; the plain and per-stage sheets keep `ORC's` and
  `Totaal`.
- A stage in **no** route would be dropped from every group, so a sheet that
  cannot place one falls back to the per-stage sheet and says so on screen.
- **A crew who did not finish is printed as `DNF` and one who never started as
  `DNS`, not as a place.** They are ranked behind the field because the standings
  have to put them somewhere, not because they finished last, so the place column
  says what happened instead of giving them a number. Their points are printed as
  they stand.
- **A crew without a class still gets printed**: on the combined sheet like
  everybody else, and on a *Zonder klasse* sheet at the back of the per-class
  print. A missing class is a gap in the entry list, not a reason to leave a
  scored crew off the results.
- **The dashboard's Print button prints what is on screen**: `?view=combined`
  from the unfiltered standings, `?class=<letter>` from a filtered one — the
  standings tab filters on a single class, so it never sends `?view=wedstrijd`.
  All of them are only a preselection — the select on the print page is what
  decides.
- **It prints A4 landscape**, always: the sheet is a wide table — place, EQ,
  class, navigator, bestuurder and four numbers — and the crew names are what
  runs out of room on a portrait page. The on-screen sheets are laid out at
  roughly that width, so what an official sees is what comes out of the printer.
- The page size and orientation, the break between two sheets and the header row
  that repeats when a sheet runs over one page are the `@page` / `break-after`
  rules Tailwind has no utility for. They live in a `<style>` on that page only
  — the QR sheet prints on the browser's own default page and stays that way. It
  is the one full-page view that does not use `PAGE_CONTAINER`: its width is the
  paper.
- **The app's navigation is not on the paper.** `ClientLayout` marks the nav
  `print:hidden`, so a printed sheet starts at its own heading instead of at the
  app's header and menu — for the QR sheet as much as for the results. Anything
  else added around the pages themselves belongs behind `print:hidden` too.

## Public results page (`app/lib/standingsQuery.ts`)

A rally's standings on paper are for the wall at the finish; this is the same
numbers for a phone. An admin turns it on per rally
(`/rallies/[id]/public-results`) and prints the QR code that page generates —
one code for the whole rally, unlike the per-participant sheet at
`.../stages/[stageId]/qr-codes` — and from then on anyone who scans it, or
opens the link, reads the current standings with **no account at all**.

- **Off by default, and an admin's own switch, not a secret.**
  `Rally.publicResultsEnabled` gates it; `PUT /api/rallies/[id]/public-results`
  (admin only, its own route rather than a field on the rally-details `PUT`,
  which requires a `name` on every call — a toggle should not have to resend
  one) is the only way to flip it. Once it is on, the rally's own id in the URL
  is the whole address — there is nothing else to guess, because the intent is
  for anyone with the link to read it.
- **It is the Algemeen klassement, on screen, filterable.** One table, the
  whole field, ranked exactly the way `/rallies/[id]/standings/print` ranks its
  combined sheet — finished crews first on points then EQ, then the DNF's, then
  the DNS's — with a classification filter (`CLASSIFICATIONS`) over the same
  fetch, the way the dashboard's own standings tab filters. No per-stage
  breakdown, no per-route or wedstrijdklasse sheets: those stay admin-only
  detail on the print page. **It never shows an answer sheet** — only the ORC's
  / Tijd / Diversen / Totaal a crew's sheets add up into, the same four numbers
  the print sheet shows and nothing a sheet's own rows would reveal.
- **The computation is shared, not reimplemented.** `computeRallyStandings` in
  `app/lib/standingsQuery.ts` is what `GET /api/rallies/[id]/standings` (the
  dashboard, session-gated) and `GET /api/public/rallies/[id]/results` (this
  page, public) both call. An official and a public reader must never see two
  different rankings of the same rally, which a second implementation would
  eventually make true by accident.
- **The public API is the third exception to "every route requires a
  session"**, after the two Android-app endpoints (`/api/app/*`). It pays for
  being public the same way they do — a per-IP rate limit
  (`app/lib/rate-limit.ts`) — but its gate is structural rather than a scanned
  credential: a participant has no identity to check at all, so their code
  *is* one; here the rally itself decides, via `publicResultsEnabled`, and a
  rally that does not exist and one that is not turned on answer the same 404
  either way, so the route cannot be used to find out which private rallies
  exist. That check runs before `computeRallyStandings`, so a disabled rally
  costs the route nothing beyond the one flag it was refused on. Do not add a
  fourth public route without an equally-considered gate of its own — a rate
  limit alone is not one.
- **`middleware.ts` treats `/public/` and `/api/public/` as prefixes**, not
  exact paths like `/login` — a rally's id is part of the address, so a fixed
  list of paths cannot cover it. Both the page and the API answer with no
  session; the API additionally skips the CSRF same-origin check the way the
  app endpoints do, though it never needs to; it is GET-only.
- **`ClientLayout` renders no app nav on a `/public/` page.** Someone who
  scanned a QR code has no session and no use for Rallies, Users or Logout —
  worse, clicking any of them would just bounce off `/login` — so the page
  builds its own minimal header instead, the same reason `/login` skips the
  nav too.
- **A duplicated rally starts with public results off**, like every rally:
  `POST /api/rallies/[id]/duplicate` builds the copy from only `name` and
  `code`, so `publicResultsEnabled` is whatever the schema defaults it to. It
  is a running-of-it setting, not part of the setup a duplicate carries over.
- **The QR code is generated in the browser**, the same encoder every other QR
  in the app uses (`app/lib/qrcode.ts`, `QrCode.tsx`) — no server round trip to
  produce it. The link it encodes is built from `window.location.origin`
  rather than a configured base URL: whoever is on `/rallies/[id]/public-results`
  printing it is an admin already signed in on the app's real address, so that
  address is correct without an environment variable to keep in sync — unlike
  the forgot-password email link, which is built with no browser to ask
  (`app/lib/email.ts`, `APP_BASE_URL`).

## Duplicating a rally

An event is run over the same course year after year: the stages, the answer keys,
the timetable and the time settings are the work. *Duplicate* — on the rally list
and in the rally dashboard header — is `POST /api/rallies/[id]/duplicate`, and it
copies exactly that.

- **The setup is copied, the running of it is not.** The **routes** come over
  first, re-numbered 1..n, and every stage comes over in running order onto the
  copy of the leg it was ridden in — a route is a document of its own, not a
  subdocument, so `withoutIds` never sees it and the stages are remapped through
  an old-id → new-id map. A stage keeps its `scoreKey` (the appeal answers and
  the `orderMatters` ticks included), `timeScoreKey`, `merkScoreKey`,
  `timeConfig` and `cardId`. The
  entry list, the answer sheets and the printed QR codes stay behind: a duplicate
  is a rally waiting for its crews, not a second copy of last year's results. It
  therefore re-scores nothing — it has no sheets, because it has no crews.
- **The copy is named `<name>-copy`** and takes the code `<CODE>-COPY`, falling
  back to `-COPY2`, `-COPY3` … while another rally already answers to one: two
  rallies on one code would make a submission from the app ambiguous. Both are
  derived in `app/lib/rallyCodes.ts` (`copyRallyName` / `copyRallyCode`, pure and
  shared, so the confirm dialog can name the copy before the request is sent) and
  the route loops until the unique index accepts a code, or answers 409.
- **The stages are stamped one millisecond apart** rather than left to default to
  the same `Date.now()`, in the order they are *read* — the flat running order,
  legs included — so the copy keeps the order of the original inside each leg
  rather than leaving it to the `_id` tie-break.
- Mongoose gives every subdocument an `_id`; the copies get their own, so the
  keys are stripped of them on the way over.
- It takes no body — the rally in the path is the whole request — and its guard
  is `requireRallyAdmin()`, like everything else that changes a rally.

## The participants' Android app

The crews type their own cards on their phones. The app
(`jurian360/android-control-card`) is offline-first: it holds the card in a
local Room database and talks to this app exactly twice.

- **The QR page** — `/rallies/[id]/stages/[stageId]/qr-codes`, reached from the
  stage view and from the stage list on the rally dashboard. It shows one card
  per participant of the rally: the EQ, the crew, the QR and the code in
  readable characters underneath, and it is laid out to be printed and cut up.
  The rally needs its entry list first — a code belongs to a *crew*, not to an
  EQ number nobody has claimed.
- **The QR holds `ADD:<code>`.** `ADD:` is the prefix the app strips from a
  scanned code; the code alone is what a participant types when a camera will
  not focus, which is why the alphabet has no `I`, `L`, `O`, `U`, `0` or `1`
  (`app/lib/appCards.ts`).
- **Two public endpoints**, `GET /api/app/card?code=…` (scan) and
  `POST /api/app/submit` (hand in). They are the only routes in this app without
  `requireSession()`, because a participant has no account: the scanned code is
  the whole credential. Both are rate limited per IP, an unknown code is a 404
  whether it is malformed or simply wrong, and a submission has to resolve to a
  `{rally, stage, eq}` an official actually printed a code for.
- **A card is handed in once.** `CardAccess.submittedAt` is set on success and a
  second submission is a 409, so somebody who guesses a rally code and an EQ
  number cannot write over a crew's sheet after they handed in. *Reopen* on the
  QR page clears the lock; *New code* replaces the code, which invalidates the
  sheet that carried the old one. The scan answers with the same lock as
  `ingeleverd`, so the app can say so before the crew types the card; neither
  the flag nor a 409 locks the card in the app, because *Reopen* is what makes
  a second hand-in legitimate.
- **The scan answers with more than the identifiers.** Beside the four values a
  submission is resolved by (`rallycode`, `kaartid`, `equipenr`, plus `kaartnr`
  for the running order), it carries `rallynaam`, `kaartnaam`, `equipenaam` and
  `klasse` — which card this is, in words. The app shows them when a code is
  scanned and above the grid, so keep them filled: a stage without a name or a
  rally without its entry list makes the app's card header thinner, not wrong.
- **Nothing about the scoring comes from the phone.** The app sends the letters
  of the 30 ORC rows (and the 6 merk rows, if a later version starts sending
  them); the totals are computed here and the participant's rally is re-scored,
  exactly as when an official saves a sheet. A card that lands on a sheet a time
  import already created keeps that sheet's WPT's.
- **The app used to call an Umbraco backend** at
  `/umbraco/surface/controlekaart/...`, which is where the Dutch field names of
  the two payloads come from. The paths themselves are gone: the app now calls
  `/api/app` directly, and its addresses live in one `ApiConfig` object so the
  next move is a one-line change.

`app/lib/qrcode.ts` is the QR encoder: byte mode, error-correction level M,
versions 1-10, no dependency — the same trade-off `app/lib/spreadsheet.ts` makes
for reading .xlsx. It returns a matrix; `QrCode.tsx` renders it as SVG so it
stays sharp on paper.

## Accounts and roles (`app/lib/roles.ts`)

Officials sign in with a **username and a password**; participants still have no
account at all (a crew authorises on the code behind their QR). There are two
roles and no plan for a third:

| | admin | data-entry |
| --- | --- | --- |
| Answer sheets: type, correct, delete | yes | **yes** |
| Read rallies, stages, keys, cards, standings | yes | yes |
| Rally, stages and answer keys | yes | no |
| Entry list, time import, QR codes, re-score | yes | no |
| Accounts | yes | no |
| Own password, own email | yes | yes |

`app/lib/roles.ts` is the one table: it is pure and shared, so the buttons a
view hides, the pages `middleware.ts` gates and the routes `api-guard.ts`
refuses cannot drift apart. **Hiding a button is never the control** — the route
guard is; a hidden button only spares an official a 403.

- **A session says who you are.** The signed cookie carries `{sub, username,
  role}` (`app/lib/session.ts`), which is what lets middleware gate an admin
  page at the edge, where there is no database. It is the role the account had
  at sign-in: `requireSession()` re-reads the account through
  `currentUser()` on every API request, so a demotion or a deletion takes effect
  on the next request rather than when the 24-hour token expires.
- **A password change signs the account's other sessions out.**
  `User.passwordChangedAt` is compared with the token's issue time; the browser
  that made the change gets a fresh cookie so it is not signed out by its own
  change.
- **The recovery admin lives in the environment**, not in the database
  (`app/lib/users.ts`): `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`, the same
  scrypt `<saltHex>:<hashHex>` a user's password is stored as. It has no
  document, so nothing in the app can delete it, demote it or lock it out, and
  it survives a restored backup — it is the way back in when every admin has
  forgotten their password. A `User` may not take its username: two accounts
  answering to one name would make a login ambiguous. `APP_PASSWORD_HASH` — the
  shared password this app had before accounts — is still read as its
  credential, so a deployment that predates this keeps working.
- **The user routes will not strand the app**: the last admin cannot be deleted
  or demoted, and nobody can delete or demote themselves. Deleting an account
  cascades nothing — the sheets it typed belong to the rally, not to the
  official who typed them.
- **Passwords are hashed in one place** (`app/lib/passwords.ts`, scrypt +
  `timingSafeEqual`), used by the login, the user routes and
  `scripts/hash-password.mjs`. A login for an unknown username spends the same
  scrypt time as a real one (`burnPasswordTime`), so the response time does not
  list which accounts exist, and every failure answers one message.
- **A `User` carries an optional email**, `sparse`-unique so two accounts
  cannot claim one address while an account added before this existed simply
  has none until an official (or the account itself, on `/account`) fills one
  in. It exists for exactly one thing: receiving a forgot-password link, below.
  Set on `/users` (an admin, for any account) or on `/account` (an account,
  for itself — `POST /api/auth/email`, which asks for the current password for
  the same reason `/api/auth/password` does: a borrowed, unlocked browser must
  not be able to redirect a reset link to an attacker's inbox). Stored already
  normalised by `normalizeEmail`, the email counterpart of `normalizeUsername`.
  A stored `''` would collide with every other `''` under the sparse index, so
  both routes write `undefined` instead when the field is cleared.
- **A `User` records its last login**: `lastLoginAt` and `lastLoginIp`,
  written by `authenticate()` in `app/lib/users.ts` on a successful database
  login and shown to admins on `/users`. The recovery admin has no document to
  write them to, so it never shows a last login — it is not tracked by design,
  the same reason nothing else about it lives in the database.

## Forgot password (`app/lib/passwordReset.ts`, `app/lib/email.ts`)

An official who forgets a password does not have to wait for an admin:
`/forgot-password` emails a reset link through Postmark, and `/reset-password`
spends it. Both pages and their two API routes are public — reachable with no
session, listed in `middleware.ts`'s `PUBLIC_PATHS` / the `/api/auth/` prefix —
the same reason `/login` is: a visitor asking for this has none yet.

- **The token is never stored raw.** `generateResetToken` (32 random bytes,
  `app/lib/passwordReset.ts`) is only ever held by the browser that requested
  it and by the email Postmark sent; the database keeps `hashResetToken`'s
  SHA-256 of it (`User.resetTokenHash`) plus `resetTokenExpiresAt`, one hour
  out. A leaked database then holds nothing that can be replayed into a
  reset — the same reasoning `app/lib/passwords.ts` applies to a password
  itself, just with SHA-256 rather than scrypt: the token is already
  high-entropy, so there is nothing to slow a guesser down that the hash search
  space does not already provide.
- **`POST /api/auth/forgot-password` answers `{ success: true }` for every
  well-formed request**, whether or not the address belongs to an account —
  the login route's "one message for every failure" rule extended to email
  enumeration. A send failure, a missing Postmark or `APP_BASE_URL`
  configuration, and a database error all land in the same generic response;
  only `console.error` sees which. Rate limited per IP, like login.
- **The reset link's domain comes from `APP_BASE_URL`, never from a request
  header.** `middleware.ts`'s CSRF check trusts `x-forwarded-host` because
  Coolify's proxy sets it and a browser cannot forge it cross-origin — but that
  argument only holds for same-origin comparisons. A mail this app sends on its
  own behalf is not one; deriving its link from a header an attacker's request
  could still supply would let a forged Host put their own domain in a
  password-reset email. `APP_BASE_URL` is a plain `requireEnv()` string for
  exactly that reason.
- **`POST /api/auth/reset-password` re-scores nothing and cascades nothing**:
  it re-hashes the submitted token, matches it against `resetTokenHash`, checks
  `resetTokenExpiresAt`, and — like a self-service or an admin-driven password
  change — sets `passwordChangedAt` (signing the account's other sessions out)
  and re-issues this browser's own cookie, landing the visitor back in the app
  rather than at a second login screen. The token fields are cleared on success
  either way, so a link is spent once.
- **Every other way a password changes clears a pending token too**: an admin
  resetting it on `/users`, and an account changing its own on `/account`. A
  reset link still sitting unread in an inbox must not go on working once the
  password it targeted has already changed through some other door.
- **Email is sent through Postmark's plain HTTP API** (`app/lib/email.ts`), no
  SDK dependency — the same trade-off `app/lib/qrcode.ts` and
  `app/lib/spreadsheet.ts` make for their own formats, since the whole surface
  needed is "send one transactional message." `POSTMARK_SERVER_TOKEN` and
  `POSTMARK_FROM_EMAIL` are read lazily inside the function that sends, like
  every other secret (`app/lib/env.ts`).

## Layout

```
app/
  api/            route handlers (rallies, stages, answersheets, auth, standings,
                  users + users/[id] to manage the officials' accounts,
                  auth/login + auth/check + auth/password (own password) +
                  auth/email (own email) + auth/forgot-password +
                  auth/reset-password (public, see app/lib/email.ts),
                  rallies/[id]/routes to list/add the legs of a rally and to
                  reorder them, .../[routeId] to rename or remove one,
                  rallies/[id]/participants to list/add the crews of a rally,
                  .../[eq] to read, save or drop one, .../import for an entry list,
                  rallies/[id]/rescore to re-score a whole rally on demand,
                  rallies/[id]/times for the WPT overview of a whole rally,
                  rallies/[id]/duplicate to copy a rally's stages and keys,
                  rallies/[id]/public-results to turn a rally's public results
                  page on or off,
                  stages/[id]/times/import for the times of one control,
                  stages/[id]/access-codes for the QR codes of one stage,
                  app/card + app/submit, the two public endpoints of the
                  Android app,
                  public/rallies/[id]/results, the public endpoint behind a
                  rally's public results page)
  components/     client components (forms, grids, card views, auth context)
  lib/            scoring, mongodb, session, validation, body, rate-limit, env,
                  layout (PAGE_CONTAINER, the one page width of the app),
                  missingSheets (a stage a crew handed no card in for, scored as
                  the blank card it stands for, shared client + server),
                  standings (finished / DNF / DNS: the three groups a result
                  sheet ranks, shared client + server),
                  standingsQuery (computeRallyStandings — one rally's ranked
                  standings, shared by the dashboard route and the public one),
                  routes (the legs of a rally: the running order, the leg
                  boundaries and a crew's totals per route, shared client +
                  server) + rallyOrder (that order read out of the database),
                  api-guard, roles (the two roles and their permissions, shared
                  client + server), passwords (scrypt), passwordReset (the
                  forgot-password token) + email (sending it, through
                  Postmark), users (accounts + the recovery admin),
                  participants (class letters and the wedstrijdklasse the
                  results group A and H into, shared client + server),
                  spreadsheet + columnMapping + participantImport + timeImport
                  (entry-list and time imports, browser side),
                  rallyCodes (a rally's public code and the name and code a
                  duplicate gets, shared client + server),
                  appCards (codes and identifiers of the Android app) + qrcode
  models/         Mongoose schemas
  rallies/...     pages (rally dashboard — the Stages / Standings / Participants
                  / Times tabs — rallies/[id]/edit for its name and
                  code, stages, answer sheets, participant view,
                  stages/[stageId]/qr-codes: the printable sheet of QR codes,
                  rallies/[id]/standings/print: the results on A4, one sheet
                  per classification,
                  rallies/[id]/public-results: turn the public results page on
                  or off and print its QR code, admin only)
  public/rallies/[id]/  the public results page itself — no session, no app nav
  time-import/    the time import wizard (rally -> stage -> control -> file)
  users/          the accounts page (admin only)
  account/        your own account: role, email and password
  forgot-password/ request a reset link by email (public)
  reset-password/  spend one, from the link the email carries (public)
  forbidden/      where middleware sends an official who lacks the role
  types/          shared TS interfaces
middleware.ts     auth + rate limit + CSRF at the edge
scripts/          generate-secret.mjs, hash-password.mjs
```

## Commands

```bash
npm ci            # install (lockfile committed)
npm run dev       # dev server, Turbopack, :3000
npm run build     # production build (output: "standalone")
npm start         # serve the build (needs .env.local)
npm run lint      # ESLint — run before committing
```

There is **no test suite**. Verify changes by running the app and, for scoring
work, by checking a sheet against the stage key by hand. Do not add a test
framework unless asked.

Environment (`.env.local`, see `.env.example` and `README.md`): `MONGODB_URI`,
`SESSION_SECRET` (≥32 chars), `APP_PASSWORD_HASH` (`<saltHex>:<hashHex>`).
Forgot password additionally needs `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`
and `APP_BASE_URL`; without them the feature simply fails closed (logged, never
surfaced — see *Forgot password* above), so it is not required to run the app.
Browse via `localhost` — the session cookie is always `Secure`.

## Conventions and invariants

**Security-sensitive; a review already hardened these (`SECURITY-AUDIT.md`).
Do not regress them.**

- Every API route starts with a guard from `app/lib/api-guard.ts` and reads its
  body with `readBody()` (256 KB cap, object-only JSON). The guard is
  `requireSession()` for a read and for writing an **answer sheet**,
  `requireRallyAdmin()` for **everything else that writes** — a rally, its
  routes, a stage or its key, the entry list, the imports, the access codes, the
  re-score — and
  `requireUserAdmin()` for `/api/users`. They all return
  `{ ok, user | response }`, so a handler starts
  `if (!session.ok) return session.response;` and can read `session.user`.
  `middleware.ts` also blocks unauthenticated requests and keeps a data-entry
  account off the admin *pages* — the per-handler guard is deliberate defence in
  depth, keep both. **Public routes are the deliberate exception**, and there
  are two kinds so far, each with its own reasoning for what stands in for a
  session: the two Android-app endpoints (`/api/app/*`) are public because a
  participant has no account, and they pay for it with a scanned-code check, a
  per-IP rate limit and a one-submission lock; `GET /api/public/rallies/[id]/results`
  is public because an admin explicitly turned that one rally's results public
  (`Rally.publicResultsEnabled`, see *Public results page*), and it pays for it
  with that per-rally flag plus a per-IP rate limit — no scanned code, because
  nothing here is a credential naming one participant, and no submission lock,
  because it never writes. Do not add another public route without an equally
  considered gate of its own; a rate limit alone is not one.
- **A new mutating route defaults to `requireRallyAdmin()`.** Typing a
  participant's card is the one thing a data-entry account may change; if a new
  route is not that, it is an admin's.
- **A `routeId` off the wire is looked up against the *stored* stage's rally**,
  never against a rally id from the body (`PUT /api/stages/[id]`), and on POST
  against the rally's own route list already in hand. A route of another rally
  would put a stage in a leg its crews never ride; this is the one
  authorization-shaped field the feature added, and it is closed twice —
  `parseObjectId` before the value reaches a query, and the rally from the
  document in the filter.
- **Never interpolate an unvalidated value into a Mongoose query.** Ids go
  through `mongoose.Types.ObjectId.isValid` (or the newer `parseObjectId` in
  `app/lib/validation.ts`, which new code uses), `eq` through
  `parseEq` / `parseEqParam`, names through `parseName`, arrays through the
  bounded parsers in `app/lib/validation.ts`. This is what closes NoSQL
  operator injection (`{"$gt": 0}`); `sanitizeFilter` is only a backstop.
- Server-only modules import `'server-only'` at the top. `app/lib/session.ts`
  and `app/lib/rate-limit.ts` run on the **Edge** runtime (middleware) — use
  **Web Crypto**, never `node:crypto`, and no timers there.
- Secrets are read lazily via `requireEnv()` inside functions, never at module
  scope: `next build` runs without secrets and a module-scope throw breaks it.
- Error responses are generic strings; details go to `console.error` only.
- Security headers and the CSP live in `next.config.ts` — the long comment there
  explains why `script-src` keeps `'unsafe-inline'`; read it before touching it.

**App conventions:**

- Pages and form components are `'use client'` and fetch from `/api/*` with
  `fetch`; there are no Server Components reading the DB yet. Route params
  arrive as `Promise` (Next 15) — `await`/resolve them.
- Fixed grid sizes: **30 answer rows × 4 letter columns, 10 time rows (start,
  8 GTC's, finish), 6 merk rows × 1 correct + 1 false letter**. If you change a count, change the form constants
  (`AnswerSheetForm.tsx`), `StageForm.tsx`, and the caps in
  `app/lib/validation.ts` (which keep headroom above the form's counts).
- Entry grids support arrow-key / auto-advance navigation via `data-grid`,
  `data-row`, `data-col` attributes — preserve them on any new input cell.
- Participant details are edited through `ParticipantDetailsForm` — used by the
  `ParticipantsPanel` on the rally dashboard (add / edit / delete) and by the
  per-participant view — so the add and the edit path cannot drift apart.
  `ClassificationBadge` renders the class letter everywhere it is shown.
  A rally's own name and code follow the same rule: `RallyDetailsForm` is shared
  by `/rallies/new` and `/rallies/[id]/edit`. While a rally is being created the
  code field follows the name until an official types in it; on an existing
  rally it never does, because renaming a rally must not silently change what
  the printed sheets say. The form warns before a code change, which is the one
  edit with a cost: a card already pulled into a phone carries the old code and
  is refused when it is handed in, so that crew has to scan again. Cards already
  handed in, and QR codes not yet scanned, are unaffected.
- `ControlekaartCard` is the shared read-only rendering of a scored sheet
  (single-sheet view and per-participant view). Prefer extending it over adding
  a parallel layout. `StageKeyCard` is its counterpart for a stage *key* — the
  same four columns, but showing the correct/false letters and the answers an
  appeal added (dashed, marked `of` on the row number), which rows are scored
  on their order, the IPT 0 timetable with the stage's time settings and the
  maximum each part can cost. A row whose order counts is marked `1→2` in the key
  card, in the scored card and in the entry grid.
- **The entry form scores while it is typed.** `AnswerSheetForm` shows the
  strafpunten of every ORC row (`calculateRowPenalty` / `hasOrderError`), of every
  time row and of every merk row as read-only cells that follow each keystroke,
  and the ORC total comes from `calculateTotalPenalty` over the stage key — the
  same modules the server stores the sheet with, so the card on screen and the
  stored total are one computation. Nothing in the STRAFP. columns is an input;
  correcting a score means correcting the letters, the times or the stage key.
- A submitted sheet is corrected on the entry form itself: `AnswerSheetForm`
  takes `initialData` + `isEditing` and the edit page PUTs to
  `/api/answersheets/[id]`. The stage of a sheet is fixed there — a sheet is
  identified by `{stageId, eq}`, so moving it is a delete plus a new sheet.
- **A sheet belongs to a crew on the entry list.** `AnswerSheetForm` picks the EQ
  from the rally's participants instead of taking a typed number, and
  `POST /api/answersheets` — plus a `PUT` that renumbers a sheet — refuses an EQ
  the rally has no `Participant` for, exactly as the time import does. The picker
  also greys out the crews that already have a sheet for the chosen stage: a
  stage holds one sheet per participant, and the time import opens that sheet as
  soon as a control hands its times in, so those letters are typed by editing it
  rather than by entering a second card. An EQ that predates the entry list stays
  selectable on its own sheet, so an already scored card remains correctable.
- Styling is Tailwind utility classes inline; no component library.
- **One page width.** Every full-page view — the top navigation, the rally
  list, the dashboard and its four tabs, the stage, key and card pages —
  wraps its content in `PAGE_CONTAINER` (`app/lib/layout.ts`), so the page
  edges do not move when an official switches a tab or opens a stage. A grid
  too wide for it scrolls inside itself; it does not widen the page. Forms
  are the exception and keep their own narrow `max-w-*`.
- Deleting cascades: deleting a rally removes its stages, sheets, participants
  and QR codes; deleting a stage removes its sheets and its QR codes. Keep that
  behaviour when touching those routes.

## Gotchas

- A role is checked in three places and they must agree: `app/lib/roles.ts` (the
  table), `middleware.ts` (which *pages* a role may open) and the route guards
  (what it may actually do). Adding an admin-only page means adding it to
  `RESTRICTED_PAGES` as well as guarding the routes behind it — a page missing
  from that list still refuses every write, it just looks broken instead of
  saying "not you".

- A card handed in from the app is a sheet write like any other, so it
  re-scores that participant's rally. If you add another way for a card to
  arrive, it has to call `rescoreParticipants` too.
- Deleting a stage or a rally deletes its `CardAccess` records too, so the
  printed QR codes stop working with it. The lookup fails closed on a code whose
  stage is gone in any case, but a code should not outlive what it stands for.
- Editing a stage's key **re-scores** existing sheets. Any new write path that
  changes a key, a stage's place in the running order, a sheet's WPT or a sheet's
  merk letters must call `rescoreRally` / `rescoreParticipants`, or standings
  silently drift. A time
  change never affects one sheet only: it moves the delta of every later stage of
  that participant.
- **The same rule covers the legs: any write that changes `Stage.routeId` or
  `Route.order`, or creates or deletes a `Route`, must re-score the rally.** A
  leg boundary is where the delta is neutralised, so moving one moves the delta
  of the whole field — and it can move which stage ends the rally, which is the
  only finish that disqualifies. Renaming a route is the one exception, and the
  *absence* of a re-score there is commented for the next reader.
- **`maxStageTimePenalty`'s third parameter is `endsRoute`, not "is this the last
  stage".** Renaming it from `isFinalStage` left a boolean taking a boolean, so
  the compiler could not find its call sites — they had to be visited by hand.
  Any future rename of a same-typed flag has the same hazard; changing the
  parameter's *type* (as `blankSheetPenalties` did, to an object) is what makes
  the compiler do the work.
- `ControlekaartCard` recomputes the ORC and the merk total from the stage's keys
  rather than reading `totalPenalty`, and sums the time penalties stored on the
  sheet's rows (it cannot recompute them without the rest of the rally).
  Standings use the stored field. Both are intentional — keep them consistent by keeping re-scoring
  correct.
- The rate limiter is in-memory and per-process; it is only correct for the
  single-container deployment. Scaling out needs a shared store.
- `COOLIFY.md` still mentions the pre-refactor `quizzes` /
  `participantanswers` collections; the live collections are `rallies`,
  `stages`, `answersheets`.
