# Deploying to Coolify

This is a Next.js 15 app (App Router) that stores data in MongoDB via Mongoose.

## 1. Create the MongoDB database

You do **not** need to create collections manually — Mongoose creates the
`quizzes` and `participantanswers` collections automatically on first write.
You only need a running MongoDB instance.

Two options in Coolify:

- **Coolify-managed MongoDB** (recommended): Coolify → your project →
  *+ New Resource* → *Databases* → *MongoDB*. Coolify generates an internal
  hostname and credentials.
- **External MongoDB**: e.g. MongoDB Atlas — use its connection string.

## 2. Deploy the app

1. Coolify → *+ New Resource* → *Application* → connect this Git repository and
   pick the branch you want to deploy.
2. **Build Pack**: choose **Dockerfile** (this repo ships a `Dockerfile`).
   Nixpacks also works, but the Dockerfile gives a smaller, reproducible image.
3. **Port**: `3000`.
4. Deploy.

## 3. Environment variables

Set these in the Coolify application's *Environment Variables* tab. Never put
real secrets in `.env.local` — that file is git-ignored and for local
development only. See `.env.example` for the full list.

| Variable            | Required | Notes                                                                    |
| ------------------- | -------- | ------------------------------------------------------------------------ |
| `MONGODB_URI`       | yes      | Full MongoDB connection string, **including a database name**.           |
| `SESSION_SECRET`    | yes      | >= 32 chars. Signs session cookies. `node scripts/generate-secret.mjs`   |
| `ADMIN_USERNAME`      | no       | Username of the recovery admin. Defaults to `admin`.                     |
| `ADMIN_PASSWORD_HASH` | yes      | scrypt hash of its password. `node scripts/hash-password.mjs '...'`      |
| `APP_PASSWORD_HASH`   | no       | The pre-accounts shared password. Read as `ADMIN_PASSWORD_HASH` when that one is unset. |
| `TRUSTED_PROXY_COUNT` | no       | Reverse proxies in front of the app, default `1` (Coolify's Traefik). Set `2` when a CDN such as Cloudflare sits in front of Traefik. See below. |

**`TRUSTED_PROXY_COUNT` decides who the rate limits see.** Every limit — login,
password reset, the app's scan and hand-in, the API as a whole — is keyed on
the client's IP, read from `X-Forwarded-For` counted from the right, because a
proxy appends the address it saw and the entries to the left of that are
whatever the client sent. Too low a number and a client can pick its own
address again; too high and every visitor shares the proxy's bucket, so one
busy official locks the rest out. With Traefik alone, `1` is right. Check it
once after a deploy: the last login IP on `/users` should be your own address,
not a `10.x`/`172.x` one.

Example `MONGODB_URI` (Coolify-managed MongoDB, note the `/orc-points-system`
database name):

```
mongodb://USER:PASSWORD@HOST:27017/orc-points-system?authSource=admin&directConnection=true
```

> If you omit the database name (`.../?directConnection=true`), MongoDB writes
> to the default `test` database. It still works, but naming the DB keeps data
> tidy and predictable.

Create a least-privilege database user with `readWrite` on `orc-points-system`
only. Do not deploy with the `root` account.

The required variables are needed at **runtime**, not at build time — the image
builds without them, and the app fails fast with a clear error on the first
request if one is missing.

## 4. Accounts and the recovery admin

Officials sign in with a username and a password, in one of two roles: an
**admin** runs the rally and manages the accounts, a **data entry** account
types control cards and reads the standings. Those accounts live in the database
and are managed on the app's **Users** page.

`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` are something else: the **recovery
admin**. It has no record in the database, so nothing in the app can delete it,
demote it or lock it out, and it still works after the database is restored from
a backup. It is how you sign in the first time, and the way back in if every
admin forgets their password.

Its password is stored as a scrypt hash; the plaintext exists nowhere in the
repository or the environment. To set or rotate it:

```bash
node scripts/hash-password.mjs 'your-new-password'
# -> ADMIN_PASSWORD_HASH=<saltHex>:<hashHex>
```

Paste the value into Coolify and redeploy.

Upgrading a deployment that predates the accounts: nothing has to change. The
old `APP_PASSWORD_HASH` is read as the recovery admin's password and its
username is `admin`, so that password still signs you in — now as an admin, with
a **Users** page to add the real accounts on.

## 5. Verify

After deploy, open the app URL. You should see the login screen. Log in, create
a quiz, and confirm data persists (a restart should keep your quizzes).

## Security notes

Addressed in the security hardening pass (see `SECURITY-AUDIT.md` for the full
findings and rationale):

- Session cookies are HMAC-signed with `SESSION_SECRET` and carry a
  server-enforced 24-hour expiry. The previous token was an unsigned base64
  marker that anyone could construct.
- The login password is a scrypt hash in the environment, compared in constant
  time, rate-limited to 5 attempts per IP per 15 minutes.
- Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`; mutating requests are
  origin-checked.
- Pages and API routes are both protected at the edge by `middleware.ts`, and
  every route handler re-checks the session independently.
- CSP (nonce-based), HSTS, `X-Frame-Options`, and `nosniff` are set on all
  responses.

Still required from an operator — these cannot be fixed in code:

1. **Rotate the MongoDB password.** The previous credentials were committed in
   `.env.local` and must be treated as compromised. The file is no longer
   tracked, but it remains in git history.
2. **Purge the credentials from git history**, coordinating with anyone holding
   a clone:
   ```bash
   git filter-repo --path .env.local --invert-paths
   git push --force-with-lease origin --all
   ```
3. **Rotate the application password** — the previous one was hardcoded in the
   source and documented in this file, so it is public to everyone with repo
   access.
