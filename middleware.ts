import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // This middleware doesn't actually do anything yet but could be
  // extended to handle authentication, logging, etc.
  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: [
    '/api/:path*', // Match all API routes
  ],
};