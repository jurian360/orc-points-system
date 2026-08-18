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
| `APP_PASSWORD_HASH` | yes      | scrypt hash of the login password. `node scripts/hash-password.mjs '...'` |

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

All three variables are required at **runtime**, not at build time — the image
builds without them, and the app fails fast with a clear error on the first
request if one is missing.

## 4. Application password

The password is stored as a scrypt hash in `APP_PASSWORD_HASH`; the plaintext
exists nowhere in the repository or the environment. To set or rotate it:

```bash
node scripts/hash-password.mjs 'your-new-password'
# -> APP_PASSWORD_HASH=<saltHex>:<hashHex>
```

Paste the value into Coolify and redeploy. This is still a single shared secret
(a gate, not per-user auth), but it is no longer recoverable from the source or
from a built image.

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
