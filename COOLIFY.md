# Deploying to Coolify

This is a Next.js 15 app (App Router) that stores data in MongoDB via Mongoose.

## 1. Create the MongoDB database

You do **not** need to create collections manually — Mongoose creates the
`quizzes` and `participantanswers` collections automatically on first write.
You only need a running MongoDB instance.

Two options in Coolify:

- **Coolify-managed MongoDB** (recommended): Coolify → your project →
  *+ New Resource* → *Databases* → *MongoDB*. Coolify generates an internal
  hostname (e.g. `wo0w800ckksgk0oowscogkog`) and credentials.
- **External MongoDB**: e.g. MongoDB Atlas — use its connection string.

## 2. Deploy the app

1. Coolify → *+ New Resource* → *Application* → connect this Git repository and
   pick the branch you want to deploy.
2. **Build Pack**: choose **Dockerfile** (this repo ships a `Dockerfile`).
   Nixpacks also works, but the Dockerfile gives a smaller, reproducible image.
3. **Port**: `3000`.
4. Deploy.

## 3. Environment variables

Set these in the Coolify application's *Environment Variables* tab (do **not**
rely on `.env.local` — that file should not hold production secrets):

| Variable      | Required | Notes                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `MONGODB_URI` | yes      | Full MongoDB connection string, **including a database name**.        |

Example (Coolify-managed MongoDB, note the `/orc-points-system` db name):

```
mongodb://root:PASSWORD@wo0w800ckksgk0oowscogkog:27017/orc-points-system?authSource=admin&directConnection=true
```

> If you omit the database name (`.../?directConnection=true`), MongoDB writes
> to the default `test` database. It still works, but naming the DB keeps data
> tidy and predictable.

## 4. Application password

The admin login password is currently **hardcoded** in
`app/api/auth/login/route.ts` (`SarkSuriname2025!`). This is a shared-secret
gate, not per-user auth. Consider moving it to an environment variable before a
public deployment (see "Security notes" below).

## 5. Verify

After deploy, open the app URL. You should see the login screen. Log in, create
a quiz, and confirm data persists (a restart should keep your quizzes).

## Security notes

- `.env.local` with live DB credentials is committed to this repo. Those
  credentials only reach a MongoDB that is internal to your Coolify network, but
  you should still rotate them and manage secrets via Coolify env vars rather
  than in git.
- The login password is hardcoded and the session cookie is a static
  base64 marker (any `...-authenticated` value passes). This is fine for a
  small internal tool but is not real authentication.
