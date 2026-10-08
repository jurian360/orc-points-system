# SARK Points System

A Next.js 15 (App Router) app for scoring rally events, storing its data in
MongoDB via Mongoose.

This README covers **running the app locally against a hosted MongoDB**
(MongoDB Atlas or any other online instance). For production deployment, see
[`COOLIFY.md`](./COOLIFY.md).

## Data model

The system is organised around rallies:

- **Rally** — the top-level event. An admin creates a rally first.
- **Stage** — a rally has multiple stages. Each stage holds an answer key
  (the score key used to grade submissions) and its timetable: the ideal
  passage times ("IPT") of participant 0 for the start, the secret time
  controls (GTC's) the stage uses and the finish.
- **Answer sheet** — a participant's submission for a single stage. A
  participant (identified by their EQ number) can have multiple answer sheets
  per rally — one per stage.

Each answer sheet is scored on two things:

- **Letters** — against the stage's answer key: 30 penalty points per wrong or
  missing answer, capped per row by the row's max penalty.
- **Time** — this is a time-speed-distance rally, so participants start one
  minute apart: participant 12 passes every control 12 minutes after
  participant 0. Officials type in the actual passage time ("WPT") of each
  control and the app charges 1 penalty point per minute the participant's
  delta moved since the previous control — they have to *hold* their delta, not
  correct it. The start of the first stage is free (it is where the delta
  begins); every later control, including the start of the next stage, counts.
  A control passed outside its window (by default 15 minutes early or 30 late;
  15/60 on a finish) costs a flat 60 points — plus the length of the break when
  it is the finish of a stage that is followed by another one — and the delta
  reverts to the last valid one. Past the finish window of the **last** stage
  the participant is disqualified. The windows, the maximum and the break are
  per-stage settings.

The **rally winner** is the participant with the **lowest total penalty** summed
across all of their answer sheets.

## Requirements

- **Node.js 22** or newer (the production image is built on `node:22-alpine`)
- **npm** (a `package-lock.json` is committed — use `npm ci` for a clean install)
- A **MongoDB connection string** you can reach from your machine

## 1. Install dependencies

```bash
git clone https://github.com/jurian360/orc-points-system.git
cd orc-points-system
npm ci
```

## 2. Set up the online MongoDB

You do **not** need to create collections by hand — Mongoose creates
`rallies`, `stages` and `answersheets` automatically on first write. You only
need a database and a user that can write to it.

Using **MongoDB Atlas**:

1. Create a free cluster (Atlas → *Build a Database* → M0).
2. Atlas → *Database Access* → *Add New Database User*. Give it the
   **`readWrite`** role on the `orc-points-system` database only — do not use
   an `atlasAdmin`/root user for the app.
3. Atlas → *Network Access* → *Add IP Address* → **Add Current IP Address**, so
   your machine may connect. (`0.0.0.0/0` opens the database to the whole
   internet — avoid it.)
4. Atlas → *Database* → *Connect* → *Drivers* → copy the connection string.

Add the database name to the string, between the host and the `?`:

```
mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/orc-points-system?retryWrites=true&w=majority
```

> Without the `/orc-points-system` part, MongoDB writes to the default `test`
> database. It works, but naming the database keeps local and production data
> predictable.

If your password contains `@`, `:`, `/` or `#`, percent-encode it
(`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).

Any other hosted MongoDB works the same way — use its own `mongodb://` or
`mongodb+srv://` URI.

## 3. Create `.env.local`

The app reads four required variables. Copy the template:

```bash
cp .env.example .env.local
```

Then generate the two secrets:

```bash
node scripts/generate-secret.mjs            # prints SESSION_SECRET=...
node scripts/hash-password.mjs                   # asks for the password, prints ADMIN_PASSWORD_HASH=...
```

`hash-password.mjs` asks for the password twice without echoing it, and requires
at least 12 characters. It deliberately does not take it on the command line,
where it would land in your shell history. The plaintext password is
never stored — only its scrypt hash goes into the environment.

That credential is the **recovery admin**: the account you sign in with when
there are no accounts yet, and the way back in if every admin later forgets
their password. It lives only in the environment, so nothing in the app can
delete it or take its role away. Everyone else gets a username and a password on
the **Users** page once you are in.

Fill in `.env.local` so it looks like this:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/orc-points-system?retryWrites=true&w=majority
SESSION_SECRET=<output of generate-secret.mjs, at least 32 chars>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<saltHex>:<hashHex>
```

`.env.local` is git-ignored (see `.gitignore`) — keep it that way; it holds a
live database credential.

### Optional: forgot password

"Forgot your password?" on the login page sends a reset link by email through
[Postmark](https://postmarkapp.com). It is optional — without it, every other
feature works the same, the forgot-password request just fails silently (an
official sees the same "check your inbox" message either way, and nothing is
sent). To turn it on, add to `.env.local`:

```bash
POSTMARK_SERVER_TOKEN=<your Postmark server's API token>
POSTMARK_FROM_EMAIL=<a Sender Signature or verified-domain address>
APP_BASE_URL=http://localhost:3000
```

Each account also needs an email on file — set your own under **Account** in
the navigation bar, or an admin sets anyone's under **Users**.

## 4. Run the dev server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and log in with
`ADMIN_USERNAME` and the password you hashed in step 3.

There are two kinds of account. An **admin** runs the rally — the stages and
their answer keys, the entry list, the time import, the QR codes and the users.
A **data entry** account types the control cards (the ORC's, the tijd and the
merk) and reads the standings, and nothing else. Add them under **Users** in the
navigation bar; everyone can change their own password under their name.

> Use `localhost` (or `127.0.0.1`), not your machine's LAN IP. The session
> cookie is always set with `Secure`, and browsers only accept a `Secure`
> cookie over HTTPS or from localhost — over `http://192.168.x.x` the login
> will appear to succeed but no session will be stored.

## Offline use (Docker Desktop)

At an event without internet the app runs on a laptop, with its own MongoDB, in
Docker Desktop. The laptop and the server never connect to each other: a rally
moves between them as a file, and an admin does the moving by hand.

1. **Once, on the laptop:** `cp .env.offline.example .env.offline`, fill in
   `SESSION_SECRET` and `ADMIN_PASSWORD_HASH` (see step 3 above), then
   `docker compose -f docker-compose.offline.yml up -d --build`. Open
   <http://localhost:3000> on the laptop itself — the session cookie is
   `Secure`, which a browser accepts over plain http on `localhost` only.
2. **Before the event, online:** set the rally up on the server (stages, keys,
   entry list), click **Export** on its dashboard and on the laptop click
   **Import Rally** on the rally list with that file.
3. **At the event:** type the cards on the laptop.
4. **Afterwards, online:** **Export** on the laptop, **Import Rally** on the
   server. The server's rally is updated and re-scored.

The file holds the rally, its routes, its stages with their answer keys, the
entry list and what was typed on every card — no points (they are scored again
on import), no accounts, no QR codes. An import matches the rally by its code
and adds or updates; it **never deletes** a stage, a crew or a card. Let one
side own a rally at a time: cards typed for the same stage and EQ on both sides
are not merged, the imported one wins.

## Available scripts

| Command         | What it does                                             |
| --------------- | -------------------------------------------------------- |
| `npm run dev`   | Dev server with Turbopack and fast refresh on port 3000  |
| `npm run build` | Production build (`output: "standalone"`)                |
| `npm start`     | Serve a production build — run `npm run build` first     |
| `npm run lint`  | ESLint                                                   |

To test the production build locally, `npm run build && npm start`. The build
itself needs no secrets — environment variables are read lazily, on the first
request that needs them — but `npm start` does, so keep `.env.local` in place.

## Troubleshooting

**`MONGODB_URI is not set ...`** — `.env.local` is missing, is not in the
project root, or the dev server was started before the file existed. Restart
`npm run dev` after creating or editing it.

**`SESSION_SECRET must be at least 32 characters long`** — regenerate it with
`node scripts/generate-secret.mjs` and paste the full value.

**Login returns "Server error"** — `ADMIN_PASSWORD_HASH` (or the older
`APP_PASSWORD_HASH`) is missing or not in `<saltHex>:<hashHex>` form. Re-run
`node scripts/hash-password.mjs` and copy the whole line's value.

**Nobody can sign in any more** — sign in with `ADMIN_USERNAME` and the password
behind `ADMIN_PASSWORD_HASH`, then reset the accounts on the **Users** page. If
that password is lost too, hash a new one and redeploy; the recovery admin is
not stored in the database, so nothing there has to be repaired.

**Login returns "Too many attempts"** — five failed logins per IP per 15
minutes. Wait it out, or restart the dev server (the rate-limiter is in-memory).

**Connection times out / `ETIMEDOUT` / `ServerSelectionError`** — your IP is
not on the Atlas *Network Access* allowlist, or the URI's host or credentials
are wrong. Verify the string with `mongosh "<your MONGODB_URI>"`.

**`bad auth : Authentication failed`** — wrong user/password, or a special
character in the password that needs percent-encoding.

**Log in succeeds but you are bounced back to `/login`** — you are browsing via
a LAN IP; switch to `http://localhost:3000` (see the note in step 4).

## Learn more

- [Next.js documentation](https://nextjs.org/docs)
- [Mongoose documentation](https://mongoosejs.com/docs/)
- [`COOLIFY.md`](./COOLIFY.md) — production deployment
- [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) — security review notes
