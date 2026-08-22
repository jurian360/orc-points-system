import 'server-only';

// Compatibility path for the Android app.
//
// The participants' app used to talk to the organisation's Umbraco backend, and
// an installed APK cannot be asked to learn a new URL shape — only a new host.
// So the two endpoints it calls keep their old paths here and forward to the
// real handlers under /api/app, which is where the logic lives and where a
// future version of the app should point.
//
// Both are public: see app/api/app/card/route.ts.
export { GET } from '../../../../api/app/card/route';
