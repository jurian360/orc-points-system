import Link from 'next/link';

// Where proxy.ts sends an official who opened a page their role does not
// have. It is a page rather than a redirect to the dashboard so the answer is
// "not you", not a silent bounce that reads like a broken link.
export default function ForbiddenPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-lg border border-gray-100 p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">No access to this page</h1>
        <p className="text-gray-600 mb-6">
          This page is for admins. A data-entry account types control cards — the ORC&apos;s, the
          tijd and the merk — and reads the standings. Ask an admin if you need more.
        </p>
        <Link
          href="/rallies"
          className="px-4 py-2 bg-blue-600 text-white rounded-md inline-block font-medium hover:bg-blue-700"
        >
          Back to the rallies
        </Link>
      </div>
    </div>
  );
}
