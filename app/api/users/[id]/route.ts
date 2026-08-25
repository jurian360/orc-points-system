import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '../../../lib/mongodb';
import { User } from '../../../models';
import { readBody, requireUserAdmin } from '../../../lib/api-guard';
import { hashPassword } from '../../../lib/passwords';
import { adminCount, isEnvAdminUsername } from '../../../lib/users';
import { parsePassword, parseRole, parseUsername } from '../../../lib/validation';
import { PASSWORD_RULE, USERNAME_RULE } from '../../../lib/roles';

// One account. Admin only, like the collection route.
//
// Two things this route will not do, so the app cannot be locked out of its own
// user management:
//
//   * take the last admin's role away, or delete the last admin;
//   * let an admin delete or demote the account they are signed in with — an
//     accident there logs you out of the page you were fixing.
//
// The recovery admin in the environment is the backstop under both, but needing
// it should be the consequence of forgotten passwords, not of one click.

function invalidId() {
  return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUserAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) return invalidId();

    await dbConnect();

    const user = await User.findById(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Only the fields that were sent are changed: the form edits a role, resets
    // a password or renames, and does not have to send the rest back.
    if (parsed.body.username !== undefined) {
      const username = parseUsername(parsed.body.username);
      if (!username) {
        return NextResponse.json({ error: `Invalid username. ${USERNAME_RULE}` }, { status: 400 });
      }
      if (isEnvAdminUsername(username)) {
        return NextResponse.json(
          { error: 'That username belongs to the recovery admin configured in the environment.' },
          { status: 409 }
        );
      }
      user.username = username;
    }

    if (parsed.body.role !== undefined) {
      const role = parseRole(parsed.body.role);
      if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

      if (user.role === 'admin' && role !== 'admin') {
        if (String(user._id) === session.user.sub) {
          return NextResponse.json(
            { error: 'You cannot take your own admin role away.' },
            { status: 409 }
          );
        }
        if ((await adminCount()) <= 1) {
          return NextResponse.json(
            { error: 'This is the last admin. Add another admin first.' },
            { status: 409 }
          );
        }
      }

      user.role = role;
    }

    if (parsed.body.password !== undefined) {
      const password = parsePassword(parsed.body.password);
      if (!password) {
        return NextResponse.json({ error: `Invalid password. ${PASSWORD_RULE}` }, { status: 400 });
      }

      user.passwordHash = await hashPassword(password);
      // A reset signs that account's sessions out, wherever they are: the point
      // of resetting a password is usually that somebody else may know it.
      user.passwordChangedAt = new Date();
    }

    await user.save();

    return NextResponse.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      passwordChangedAt: user.passwordChangedAt,
      createdAt: user.createdAt,
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
    }

    console.error('Failed to update user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUserAdmin();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) return invalidId();

    await dbConnect();

    const user = await User.findById(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (String(user._id) === session.user.sub) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 409 });
    }

    if (user.role === 'admin' && (await adminCount()) <= 1) {
      return NextResponse.json(
        { error: 'This is the last admin. Add another admin first.' },
        { status: 409 }
      );
    }

    await user.deleteOne();

    // Nothing cascades. An account owns no rally data: the sheets it typed
    // belong to the rally, not to the official who typed them.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
