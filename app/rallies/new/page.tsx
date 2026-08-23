'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import RallyDetailsForm from '../../components/RallyDetailsForm';

export default function NewRallyPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Create New Rally</h1>
          <p className="text-gray-600 mt-2">
            Give the rally a name and the short code the crews will see. You&apos;ll add its
            stages and answer keys next.
          </p>
        </div>

        <RallyDetailsForm
          submitLabel="Create Rally"
          // Go straight to the new rally so the admin can add stages.
          onSaved={(rally) => router.push(`/rallies/${rally._id}`)}
        />

        <div className="mt-6">
          <Link href="/rallies" className="text-blue-600 hover:underline">
            &larr; Back to Rallies
          </Link>
        </div>
      </div>
    </div>
  );
}
