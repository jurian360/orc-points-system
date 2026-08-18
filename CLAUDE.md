# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this project is

**ORC Points System** — a web app for scoring **rally events** (SARK-style road
rallies) on **penalty points** ("strafpunten"). Officials create a rally, add
its stages with the correct answer key per stage, then type in each
participant's paper control card. The app grades every sheet and keeps a live
rally standing.

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
| **IPT / WPT / +/-** | Time-control columns (ideal vs. actual passage time and the difference), 10 rows, scored by officials. |
| **Merk** | Marker/sign rows, 6 rows, scored by officials. |

## Data model (`app/models/index.ts`)

```
Rally ──< Stage ──< AnswerSheet
   └──────────────────┘  (AnswerSheet also stores rallyId for cheap standings)
```

- `Stage.scoreKey` — 30 rows: `{ rowNumber, answers[], falseAnswers[{column,value}], maxPenalty }`.
  Also `timeScoreKey` (10 rows) and `merkScoreKey` (6 rows) as officials' reference.
- `AnswerSheet` — `{ eq, rallyId, stageId, answers[], timePenalties[], merkScores[], totalPenalty }`.
- **Unique index `{ stageId, eq }`** — one sheet per participant per stage. The
  pre-insert `findOne` check is a nicety; the index is the real guard, and the
  `11000` duplicate-key error is mapped to a 409.
- `totalPenalty` is **denormalised** on the sheet: computed server-side at write
  time and re-computed for every sheet of a stage when that stage's key is
  edited (`PUT /api/stages/[id]`, one `bulkWrite`). Standings read this field.

## Scoring rules (`app/lib/scoring.ts`)

`PENALTY_PER_ERROR = 30`. Per ORC row, against that row's key:

1. Each selected letter listed in the row's `falseAnswers` → **+30**.
2. More correct letters given than the key expects → **+30** (once).
3. Each required correct letter **missing** → **+30**.
4. The row total is then **capped at `maxPenalty`** when `maxPenalty > 0`
   (`0` / undefined means no cap).

Sheet total = sum over the key's rows. Rally total = sum of a participant's
sheet totals; standings sort ascending, ties broken by EQ.

Time (IPT/WPT/+/-) and Merk penalties are typed in **by officials** — they are
not derived from a key. They are shown and summed in the card view but are
**not** part of `calculateTotalPenalty` / `totalPenalty`.

This module is shared by the API and the React views on purpose: the scoring
detail must agree with the stored total. **If you change a rule, change it
here only** — never re-implement scoring in a component or a route.

## Layout

```
app/
  api/            route handlers (rallies, stages, answersheets, auth, standings)
  components/     client components (forms, grids, card views, auth context)
  lib/            scoring, mongodb, session, validation, body, rate-limit, env, api-guard
  lib/ocr/        browser-only controlekaart scanner (see docs/SCORECARD-OCR.md)
  models/         Mongoose schemas
  rallies/...     pages (rally dashboard, stages, answer sheets, participant view)
  types/          shared TS interfaces
middleware.ts     auth + rate limit + CSRF at the edge
scripts/          generate-secret.mjs, hash-password.mjs, setup-ocr-assets.mjs
public/ocr/       Tesseract runtime, staged from node_modules — gitignored
```

## Commands

```bash
npm ci            # install (lockfile committed)
npm run dev       # dev server, Turbopack, :3000
npm run build     # production build (output: "standalone")
npm start         # serve the build (needs .env.local)
npm run lint      # ESLint — run before committing
npm run setup:ocr # stage the OCR runtime into public/ocr (auto-runs pre dev/build)
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
- Fixed grid sizes: **30 answer rows × 4 letter columns, 10 time rows, 6 merk
  rows**. If you change a count, change the form constants
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

- Editing a stage's answer key **re-scores** existing sheets. Any new write path
  that changes a key must do the same, or standings silently drift.
- `ControlekaartCard` recomputes the ORC total from the key rather than reading
  `totalPenalty`, so the displayed rows always add up. Standings use the stored
  field. Both are intentional — keep them consistent by keeping re-scoring
  correct.
- The rate limiter is in-memory and per-process; it is only correct for the
  single-container deployment. Scaling out needs a shared store.
- `COOLIFY.md` still mentions the pre-refactor `quizzes` /
  `participantanswers` collections; the live collections are `rallies`,
  `stages`, `answersheets`.
- The camera scanner fills **only** ORC letters and IPT / WPT / +/-. Strafpunten
  and Merk stay manual, and a blank scanned cell never clears a typed one.
  Everything under `app/lib/ocr` runs in the browser: no `server-only`, no
  `node:` builtins. `public/ocr/` is a build output — never commit it.
- The scanner needed three header changes in `next.config.ts`
  (`'wasm-unsafe-eval'`, `worker-src 'self'`, `camera=(self)`). They are as
  narrow as the feature allows; `docs/SCORECARD-OCR.md` §4 explains each.
