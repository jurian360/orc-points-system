import 'server-only';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '../../../lib/session';

export async function GET() {
  try {
    const cookieStore = await cookies();

    // Full signature + expiry verification, the same check middleware runs.
    // Previously this accepted any cookie whose base64 decoding contained the
    // string "-authenticated", which anyone could construct.
    const authenticated = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

    return NextResponse.json({ authenticated });
  } catch (error) {
    console.error('Session check failed:', error);
    return NextResponse.json({ authenticated: false });
  }
}
