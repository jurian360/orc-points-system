# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this project is

**ORC Points System** — a web app for scoring **rally events** (SARK-style road
rallies) on **penalty points** ("strafpunten"). It is a time-speed-distance
rally: participants start a minute apart and have to hold their time schedule.
Officials create a rally, add its stages with the correct answer key and the
stage timetable, then type in each participant's paper control card. The app
grades every sheet — letters and times — and keeps a live rally standing.

Lowest total penalty wins. Points are a penalty, never a reward — nothing in
this system ever subtracts.

Stack: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4**, data in
**MongoDB via Mongoose**. Deployed as a single container (see `COOLIFY.md`).

## Domain glossary

The UI is Dutch-flavoured because it mirrors a physical card. Keep these terms
in code and UI — do not "translate" them:

| Term | Meaning |
| --- | --- |
| **Rally** | Top-level event. Has many stages. |
| **Stage** | One leg of a rally. Holds the answer key used to grade sheets. |
| **Answer sheet** | One participant's submission for **one** stage. |
| **EQ** | Participant/equipe number, integer `1..100`. Identifies a competitor — there are no user accounts. |
| **Classification** | The class a crew rides in: `B`, `A`, `H`, `I` or `T` (or empty while unknown). Recorded per participant, not used by the scoring. |
| **Controlekaart** | The paper control card the whole UI is modelled on: 4 columns — ORC's 1–15 \| ORC's 16–30 \| For Official Use Only (time) \| Merk + TOTAAL STRAFPUNTEN. |
| **ORC's** | The 30 lettered answer rows, up to 4 letters (columns) per row. |
| **Strafp. / strafpunten** | Penalty points. |
| **IPT / WPT / +/-** | Time-control columns: ideal passage time, actual passage time and the difference ("delta") in minutes. 10 rows, scored by the app. |
| **IPT 0** | The stage timetable as written for participant 0. Participant `eq` passes `eq` minutes later. |
| **GTC** | "Geheime Tijds Controle" — a secret time control, rows 2-9 of the time column. Participants do not know its ideal time beforehand. A stage uses as many as it needs (2, 4, ...); a row without an IPT 0 is not a checkpoint. |
| **Delta** | How many minutes a participant is off their own schedule. It runs from the start of the rally to the last stage. |
| **Merk** | Marker/sign rows, 6 rows, scored by officials. |

## Data model (`app/models/index.ts`)

```
Rally ──< Stage ──< AnswerSheet
   ├──────────────────┘  (AnswerSheet also stores rallyId for cheap standings)
   └──< Participant      (optional details of one EQ: class + crew names)
```

- `Stage.scoreKey` — 30 rows:
  `{ rowNumber, answers[], falseAnswers[{column,value}], maxPenalty, orderMatters }`.
  `orderMatters` is the officials' "volgorde" tick: the row's letters have to be
  given in the order of the key. Only ORC rows carry it — the time and merk
  columns hold single values and have no order.
  `timeScoreKey` (10 rows) holds the stage timetable — `ipt` is the ideal
  passage time of participant 0 — and `timeConfig` its time-penalty settings
  (windows, maximum, break after the stage). `merkScoreKey` (6 rows) stays an
  officials' reference.
- `AnswerSheet` — `{ eq, rallyId, stageId, answers[], timePenalties[], merkScores[],
  totalPenalty, timePenalty, disqualified, startDelta, endDelta }`. On a time row
  officials type only the `wpt`; `ipt`, `plusMinus` and `strafp` are computed
  server-side.
- **Unique index `{ stageId, eq }`** — one sheet per participant per stage. The
  pre-insert `findOne` check is a nicety; the index is the real guard, and the
  `11000` duplicate-key error is mapped to a 409.
- `Participant` — `{ rallyId, eq, classification, driverName, navigatorName }`, the
  crew behind an EQ number of one rally. Optional and inert: nothing in the
  scoring reads it, an EQ with sheets but no record is still scored, and a record
  without sheets does not appear in the standings (it has nothing to rank).
  **Unique index `{ rallyId, eq }`**; the `11000` duplicate-key error is mapped
  to a 409, same as the sheets. `PUT /api/rallies/[id]/participants/[eq]` upserts
  because a participant usually exists as sheets before anybody types their name;
  `POST /api/rallies/[id]/participants` only creates, so a taken EQ warns instead
  of overwriting another crew. Deleting a participant removes the record *and*
  their sheets in that rally. `POST .../participants/import` writes a whole entry
  list in one `bulkWrite` of upserts — see the import section below.
- `totalPenalty` is **denormalised** on the sheet: the ORC's penalty plus the
  time penalty, computed server-side at write time. Standings read this field.
  Re-scoring goes through `app/lib/rescore.ts` (`rescoreRally` /
  `rescoreParticipants`, one `bulkWrite`) because the time part is a chain — see
  the scoring rules below.
- The **running order** of a rally is the creation order of its stages
  (`sort({ createdAt: 1, _id: 1 })`, both in `GET /api/stages` and in the
  re-scoring). The last stage in that order is the one whose finish
  disqualifies.

## Scoring rules (`app/lib/scoring.ts`)

`PENALTY_PER_ERROR = 30`. Per ORC row, against that row's key:

1. Each selected letter listed in the row's `falseAnswers` → **+30**.
2. More correct letters given than the key expects → **+30** (once).
3. Each required correct letter **missing** → **+30**.
4. On a row with `orderMatters`, the correct letters given **out of the key's
   order** → **+30**, once, on top of what the letters themselves cost.
5. The row total is then **capped at `maxPenalty`** when `maxPenalty > 0`
   (`0` / undefined means no cap).

The order rule (rule 4) reads the letters left to right, ignores the ones that
are not in the key, and asks whether what is left is a **subsequence** of the
key — for the key `BAC`, `BC` and `AC` are in order, `CA` and `AB` are not. It
never fires when it cannot tell: a key of one letter has no order, and **one
correct letter given is never out of order**. So on the key `NW`: `WN` costs 30
for the order, `N` alone costs 30 for the missing `W` and nothing more, and on
the key `BAC` both `CA` and `AB` cost 60 — 30 for the missing letter and 30 for
the order, because two letters do show an order.

Sheet total = ORC's rows + the stage's time penalty. Rally total = sum of a
participant's sheet totals; standings sort ascending, ties broken by EQ, with
disqualified participants last. A standings entry carries the two parts as well
(`orcPenalty` / `timePenalty`, the ORC's part being the stored total minus the
stored time part), so the table shows an ORC's, a Tijd and a Total column.

Merk penalties are typed in **by officials** — they are not derived from a key,
and they are shown and summed in the card view but are **not** part of
`totalPenalty` or of the standings.

This module is shared by the API and the React views on purpose: the scoring
detail must agree with the stored total. **If you change a rule, change it
here only** — never re-implement scoring in a component or a route.

## Time scoring rules (`app/lib/timeScoring.ts`)

`PENALTY_PER_MINUTE = 1`. A stage's time column has 10 rows: row 1 is the
**start**, rows 2-9 are the **GTC's** it uses, row 10 is the **finish**. The key
holds the ideal time of participant 0, so `IPT(eq, row) = IPT0(row) + eq`
minutes. Officials type the WPT; the delta is `WPT - IPT` in minutes.

1. The delta starts at **0** at the start of the rally and **carries from stage
   to stage**, up to the last one.
2. The **start of the first stage is free**: it is where the rally begins, so it
   costs nothing and does not move the delta — a participant sent away late does
   not get to keep that as their delta. The start of every later stage *is*
   scored (it has no window), so a participant who carries `+3` and starts the
   next stage on time pays those 3 points.
3. A control costs **1 point per minute the delta moved** since the previous
   control — arriving `+5` costs 5, then dropping back to `+3` costs 2 more.
   Participants have to *keep* their delta, not undo it.
4. A **GTC outside its window** (default 15 early / 30 late) costs a flat
   maximum (default 60) and **never moves the delta**: it reverts to the last
   valid one, so the next control is measured against that.
5. The **finish of a stage that is followed by another one**, outside its window,
   costs that maximum **plus the break after the stage** (`timeConfig.breakMinutes`,
   which differs per stage) — and, like any blown window, leaves the delta at the
   last valid one.
6. The **finish of the last stage** has a wider window (default 15 early / 60
   late); outside it the participant is **disqualified** (`disqualified` on the
   sheet; standings rank them behind everyone else).
7. A row with no IPT 0 is not a checkpoint of that stage, and a checkpoint with
   no WPT yet is simply not scored.

Windows, the maximum and the break live in `Stage.timeConfig` so an event can be
run with different limits; `DEFAULT_TIME_CONFIG` holds the standard ones.

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
  time (`createMissingSheets`, on by default) — empty `answers` score nothing, so
  the ORC's can still be typed on the card later.
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

## Layout

```
app/
  api/            route handlers (rallies, stages, answersheets, auth, standings,
                  rallies/[id]/participants to list/add the crews of a rally,
                  .../[eq] to read, save or drop one, .../import for an entry list,
                  rallies/[id]/rescore to re-score a whole rally on demand,
                  stages/[id]/times/import for the times of one control)
  components/     client components (forms, grids, card views, auth context)
  lib/            scoring, mongodb, session, validation, body, rate-limit, env,
                  api-guard, participants (class letters, shared client + server),
                  spreadsheet + columnMapping + participantImport + timeImport
                  (entry-list and time imports, browser side)
  models/         Mongoose schemas
  rallies/...     pages (rally dashboard, stages, answer sheets, participant view)
  time-import/    the time import wizard (rally -> stage -> control -> file)
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
Browse via `localhost` — the session cookie is always `Secure`.

## Conventions and invariants

**Security-sensitive; a review already hardened these (`SECURITY-AUDIT.md`).
Do not regress them.**

- Every API route starts with `await requireSession()` and reads its body with
  `readBody()` (256 KB cap, object-only JSON). `middleware.ts` also blocks
  unauthenticated requests — the per-handler guard is deliberate defence in
  depth, keep both.
- **Never interpolate an unvalidated value into a Mongoose query.** Ids go
  through `mongoose.Types.ObjectId.isValid`, `eq` through
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
  8 GTC's, finish), 6 merk rows**. If you change a count, change the form constants
  (`AnswerSheetForm.tsx`), `StageForm.tsx`, and the caps in
  `app/lib/validation.ts` (which keep headroom above the form's counts).
- Entry grids support arrow-key / auto-advance navigation via `data-grid`,
  `data-row`, `data-col` attributes — preserve them on any new input cell.
- Participant details are edited through `ParticipantDetailsForm` — used by the
  `ParticipantsPanel` on the rally dashboard (add / edit / delete) and by the
  per-participant view — so the add and the edit path cannot drift apart.
  `ClassificationBadge` renders the class letter everywhere it is shown.
- `ControlekaartCard` is the shared read-only rendering of a scored sheet
  (single-sheet view and per-participant view). Prefer extending it over adding
  a parallel layout. `StageKeyCard` is its counterpart for a stage *key* — the
  same four columns, but showing the correct/false letters, which rows are scored
  on their order, the IPT 0 timetable with the stage's time settings and the
  maximum each part can cost. A row whose order counts is marked `1→2` in the key
  card, in the scored card and in the entry grid.
- A submitted sheet is corrected on the entry form itself: `AnswerSheetForm`
  takes `initialData` + `isEditing` and the edit page PUTs to
  `/api/answersheets/[id]`. The stage of a sheet is fixed there — a sheet is
  identified by `{stageId, eq}`, so moving it is a delete plus a new sheet.
- Styling is Tailwind utility classes inline; no component library.
- Deleting cascades: deleting a rally removes its stages and sheets, deleting a
  stage removes its sheets. Keep that behaviour when touching those routes.

## Gotchas

- Editing a stage's key **re-scores** existing sheets. Any new write path that
  changes a key, a stage's place in the running order or a sheet's WPT must call
  `rescoreRally` / `rescoreParticipants`, or standings silently drift. A time
  change never affects one sheet only: it moves the delta of every later stage of
  that participant.
- `ControlekaartCard` recomputes the ORC total from the key rather than reading
  `totalPenalty`, and sums the time penalties stored on the sheet's rows (it
  cannot recompute them without the rest of the rally). Standings use the stored
  field. Both are intentional — keep them consistent by keeping re-scoring
  correct.
- The rate limiter is in-memory and per-process; it is only correct for the
  single-container deployment. Scaling out needs a shared store.
- `COOLIFY.md` still mentions the pre-refactor `quizzes` /
  `participantanswers` collections; the live collections are `rallies`,
  `stages`, `answersheets`.
