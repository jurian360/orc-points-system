#!/usr/bin/env node
// Generate the ADMIN_PASSWORD_HASH value for the recovery admin's password.
//
//   node scripts/hash-password.mjs 'your-new-password'
//
// Paste the output into the deployment's environment (Coolify -> Environment
// Variables), next to ADMIN_USERNAME. The plaintext is never stored.
//
// That account is the way back in when every admin has forgotten their
// password: it has no record in the database, so nothing in the app can delete
// it or take its role away. The accounts officials use day to day are added on
// the /users page instead, and their passwords are hashed the same way by the
// app itself.
//
// APP_PASSWORD_HASH — the name this printed before accounts existed — is still
// read as the same credential, so an older deployment keeps working unchanged.

import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

if (password.length < 12) {
  console.error('Refusing to hash: use a password of at least 12 characters.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await derive(password, salt, 64);

console.log(`ADMIN_PASSWORD_HASH=${salt.toString('hex')}:${hash.toString('hex')}`);
