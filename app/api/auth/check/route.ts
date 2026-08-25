import 'server-only';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSessionToken } from '../../../lib/session';
import { currentUser } from '../../../lib/users';

// Who is signed in, for the client: the nav and the forms hide what this
// account may not do. That is a convenience, never the control — the API guards
// in app/lib/api-guard.ts are — so nothing here is trusted by the server.
export async function GET() {
  try {
    const cookieStore = await cookies();

    // Full signature + expiry verification, the same check middleware runs.
    // Previously this accepted any cookie whose base64 decoding contained the
    // string "-authenticated", which anyone could construct.
    const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (!session) return NextResponse.json({ authenticated: false });

    // The role in the cookie is the one this account had at sign-in; the answer
    // has to be the current one, or a demoted official keeps seeing admin
    // buttons that every route refuses.
    const user = await currentUser(session);
    if (!user) return NextResponse.json({ authenticated: false });

    return NextResponse.json({
      authenticated: true,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error('Session check failed:', error);
    return NextResponse.json({ authenticated: false });
  }
}
