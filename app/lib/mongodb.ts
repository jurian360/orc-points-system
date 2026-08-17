import 'server-only';

import mongoose from 'mongoose';
import { requireEnv } from './env';

// Reject query objects containing operators ($gt, $ne, ...) where a plain value
// is expected. The route handlers validate their inputs explicitly; this is the
// backstop for anything that slips through.
mongoose.set('sanitizeFilter', true);

// Global mongoose object
declare global {
  // eslint-disable-next-line no-var
  var mongoose: {
    conn: mongoose.Connection | null;
    promise: Promise<mongoose.Connection> | null;
  } | undefined;
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  // At this point, cached is guaranteed to be defined due to the check above
  if (cached!.conn) {
    return cached!.conn;
  }

  if (!cached!.promise) {
    const opts = {
      bufferCommands: false,
    };

    // Read the URI here rather than at module scope: `next build` runs without
    // secrets present (see the Dockerfile), so a module-scope throw would break
    // the build. This still fails fast — on the first request that needs the
    // database — instead of silently falling back to a local instance.
    const uri = requireEnv('MONGODB_URI');

    cached!.promise = mongoose.connect(uri, opts).then((mongoose) => {
      return mongoose.connection;
    });
  }

  try {
    cached!.conn = await cached!.promise;
    return cached!.conn;
  } catch (error) {
    // Reset the promise if connection fails
    cached!.promise = null;
    throw error;
  }
}

export default dbConnect;