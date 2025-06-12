import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const CORRECT_PASSWORD = 'SarkSuriname2025!';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (password === CORRECT_PASSWORD) {
      // Create a simple session token (in production, use a proper JWT or session management)
      const sessionToken = Buffer.from(`${Date.now()}-authenticated`).toString('base64');
      
      // Set the session cookie
      const cookieStore = await cookies();
      cookieStore.set('session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24, // 24 hours
        path: '/'
      });

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Logout - clear the session cookie
    const cookieStore = await cookies();
    cookieStore.delete('session');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}