import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get('session');
    
    if (session && session.value) {
      // In a real app, you'd validate the session token properly
      // For now, we just check if it exists and looks like our format
      try {
        const decoded = Buffer.from(session.value, 'base64').toString();
        if (decoded.includes('-authenticated')) {
          return NextResponse.json({ authenticated: true });
        }
      } catch (error) {
        // Invalid session token
      }
    }
    
    return NextResponse.json({ authenticated: false });
  } catch (error) {
    return NextResponse.json({ authenticated: false });
  }
}