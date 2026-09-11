import 'server-only';

// Outgoing email, sent through Postmark's HTTP API directly — no SDK
// dependency, the same trade-off app/lib/qrcode.ts and app/lib/spreadsheet.ts
// make for their own formats. The whole surface this app needs is "send one
// transactional message," which is a single fetch.
//
// POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL are read lazily inside the
// function that needs them (see app/lib/env.ts): `next build` runs without
// secrets, and a module-scope read would break it.

import { requireEnv } from './env';

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

interface SendEmailOptions {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

async function sendEmail(options: SendEmailOptions): Promise<void> {
  const token = requireEnv('POSTMARK_SERVER_TOKEN');
  const from = requireEnv('POSTMARK_FROM_EMAIL');

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: options.to,
      Subject: options.subject,
      TextBody: options.textBody,
      HtmlBody: options.htmlBody,
      MessageStream: 'outbound',
    }),
  });

  if (!response.ok) {
    // The body carries Postmark's own error code and message; keep it out of
    // the client response (see the generic-errors rule) but worth logging.
    const detail = await response.text().catch(() => '');
    throw new Error(`Postmark request failed with status ${response.status}: ${detail.slice(0, 500)}`);
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Reset your SARK Points System password',
    textBody:
      'A password reset was requested for your account on the SARK Points System.\n\n' +
      `Open this link to choose a new password:\n${resetUrl}\n\n` +
      'The link expires in one hour and can be used once. If you did not request ' +
      'this, you can ignore this email — your password will not change.',
    htmlBody:
      '<p>A password reset was requested for your account on the SARK Points System.</p>' +
      `<p><a href="${resetUrl}">Choose a new password</a></p>` +
      '<p>The link expires in one hour and can be used once. If you did not request ' +
      'this, you can ignore this email — your password will not change.</p>',
  });
}
