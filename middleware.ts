import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Get the session cookie
  const session = request.cookies.get('session');
  
  // Check if the request is for an API route
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Allow auth-related API routes
    if (request.nextUrl.pathname.startsWith('/api/auth/')) {
      return NextResponse.next();
    }
    
    // For other API routes, check authentication
    if (!session || !session.value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Validate session token format
    try {
      const decoded = Buffer.from(session.value, 'base64').toString();
      if (!decoded.includes('-authenticated')) {
        return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
      }
    } catch (error) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: [
    '/api/:path*', // Match all API routes
  ],
};