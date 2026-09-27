#!/usr/bin/env node
// Generate the ADMIN_PASSWORD_HASH value for the recovery admin's password.
//
//   node scripts/hash-password.mjs
//
// asks for the password twice, without echoing it, and prints the line to
// paste into the deployment's environment (Coolify -> Environment Variables),
// next to ADMIN_USERNAME. The plaintext is never stored.
//
// The password is read from the terminal, not from the command line: an
// argument lands in the shell's history file and in the process list for as
// long as the script runs, and this is the credential of the account nothing
// in the app can lock out. It can also be piped in, for a script:
//
//   printf '%s' "$PASSWORD" | node scripts/hash-password.mjs
//
// Passing it as an argument (`node scripts/hash-password.mjs 'password'`) still
// works so older instructions do not break, but it prints a warning.
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
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

// Ask on the terminal with the typed characters hidden. Prompts go to stderr so
// that redirecting the output (`> hash.txt`) captures only the result.
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(prompt, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    // The prompt itself is written synchronously by question(); everything
    // after it is the password being typed.
    muted = true;
  });
}

async function readPiped() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  // A trailing newline is the pipe's, not the password's.
  return data.replace(/\r?\n$/, '');
}

async function readPassword() {
  if (process.argv[2] !== undefined) {
    console.error(
      'Warning: a password given as an argument is kept in your shell history and is ' +
        'visible in the process list. Run this without arguments to be asked for it.'
    );
    return process.argv[2];
  }

  if (!process.stdin.isTTY) return readPiped();

  const password = await askHidden('Password: ');
  const repeated = await askHidden('Repeat password: ');
  if (password !== repeated) {
    console.error('The two passwords do not match.');
    process.exit(1);
  }
  return password;
}

const password = await readPassword();

if (!password) {
  console.error('No password given.');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Refusing to hash: use a password of at least 12 characters.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await derive(password, salt, 64);

console.log(`ADMIN_PASSWORD_HASH=${salt.toString('hex')}:${hash.toString('hex')}`);
