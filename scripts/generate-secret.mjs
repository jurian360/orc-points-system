#!/usr/bin/env node
// Generate a SESSION_SECRET for signing session tokens.
//
//   node scripts/generate-secret.mjs
//
// Paste the output into the deployment's SESSION_SECRET environment variable.
// Changing this value invalidates every issued session, which is also the
// blunt way to force-log-out all users.

import { randomBytes } from 'node:crypto';

console.log(`SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
