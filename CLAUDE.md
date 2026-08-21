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
   └──────────────────┘  (AnswerSheet also stores rallyId for cheap standings)
```

- `Stage.scoreKey` — 30 rows: `{ rowNumber, answers[], falseAnswers[{column,value}], maxPenalty }`.
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
4. The row total is then **capped at `maxPenalty`** when `maxPenalty > 0`
   (`0` / undefined means no cap).

Sheet total = ORC's rows + the stage's time penalty. Rally total = sum of a
participant's sheet totals; standings sort ascending, ties broken by EQ, with
disqualified participants last.

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

## Layout

```
app/
  api/            route handlers (rallies, stages, answersheets, auth, standings)
  components/     client components (forms, grids, card views, auth context)
  lib/            scoring, mongodb, session, validation, body, rate-limit, env, api-guard
  models/         Mongoose schemas
  rallies/...     pages (rally dashboard, stages, answer sheets, participant view)
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
- `ControlekaartCard` is the shared read-only rendering of a scored sheet
  (single-sheet view and per-participant view). Prefer extending it over adding
  a parallel layout.
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
