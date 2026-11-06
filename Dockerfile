# syntax=docker/dockerfile:1

# The base image is pinned to a digest, not only to the `26-alpine` tag: a tag
# moves, so the same commit could build on a different Node or Alpine from one
# deploy to the next without anybody choosing that. A pinned digest also stops
# picking up their security patches, so .github/dependabot.yml proposes the
# new digest as a pull request every week — merge it to take the patches.
# All three stages use the same image; Dependabot updates them together.

# ---- Dependencies ----
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Builder ----
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# MONGODB_URI is not required at build time (no static DB access), but Next.js
# reads NODE_ENV=production here for an optimized build.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy the standalone server output produced by `output: "standalone"`.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
