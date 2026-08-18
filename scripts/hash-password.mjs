#!/usr/bin/env node
// Generate the APP_PASSWORD_HASH value for a chosen application password.
//
//   node scripts/hash-password.mjs 'your-new-password'
//
// Paste the output into the deployment's APP_PASSWORD_HASH environment
// variable (Coolify -> Environment Variables). The plaintext is never stored.

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

console.log(`APP_PASSWORD_HASH=${salt.toString('hex')}:${hash.toString('hex')}`);
