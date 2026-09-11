import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { User } from '../../models';
import { readBody, requireUserAdmin } from '../../lib/api-guard';
import { hashPassword } from '../../lib/passwords';
import { duplicateAccountField, isEnvAdminUsername } from '../../lib/users';
import { parseOptionalEmail, parsePassword, parseRole, parseUsername } from '../../lib/validation';
import { EMAIL_RULE, PASSWORD_RULE, USERNAME_RULE } from '../../lib/roles';

// The accounts of the officials. Admin only, all of it — a data-entry user
// types cards and reads the standings, and that is the whole of it.
//
// A password hash never leaves this route: every response projects the same
// fields.
const PUBLIC_FIELDS =
  'username email role active lastLoginAt lastLoginIp passwordChangedAt createdAt';

// GET /api/users — every account, oldest first.
export async function GET() {
  const session = await requireUserAdmin();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const users = await User.find({}, PUBLIC_FIELDS).sort({ createdAt: 1, _id: 1 });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST /api/users — add an account.
export async function POST(request: NextRequest) {
  const session = await requireUserAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const username = parseUsername(parsed.body.username);
  if (!username) {
    return NextResponse.json({ error: `Invalid username. ${USERNAME_RULE}` }, { status: 400 });
  }

  const role = parseRole(parsed.body.role);
  if (!role) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const password = parsePassword(parsed.body.password);
  if (!password) {
    return NextResponse.json({ error: `Invalid password. ${PASSWORD_RULE}` }, { status: 400 });
  }

  // Optional, like on the crew's own details: '' means "no email yet", not "an
  // invalid one".
  const email = parseOptionalEmail(parsed.body.email);
  if (email === null) {
    return NextResponse.json({ error: `Invalid email. ${EMAIL_RULE}` }, { status: 400 });
  }

  // The break-glass account from the environment has no document, so a user
  // taking its name would not overwrite it — it would shadow it, and the
  // account that lost would be the one that exists to be un-loseable.
  if (isEnvAdminUsername(username)) {
    return NextResponse.json(
      { error: 'That username belongs to the recovery admin configured in the environment.' },
      { status: 409 }
    );
  }

  try {
    await dbConnect();

    const user = await User.create({
      username,
      email: email || undefined,
      role,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
    });

    return NextResponse.json(
      {
        _id: user._id,
        username: user.username,
        email: user.email ?? '',
        role: user.role,
        active: user.active,
        createdAt: user.createdAt,
      },
      { status: 201 }
    );
  } catch (error) {
    // The unique indexes are the real guard against two accounts answering to
    // one username or one email.
    const field = duplicateAccountField(error);
    if (field === 'email') {
      return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 });
    }
    if (field === 'username') {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
    }

    console.error('Failed to create user:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
