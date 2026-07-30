'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewRallyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter a rally name.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/rallies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error('Failed to create rally');
      }

      const rally = await response.json();
      // Go straight to the new rally so the admin can add stages.
      router.push(`/rallies/${rally._id}`);
    } catch (err) {
      setError('Failed to create rally. Please try again.');
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Create New Rally</h1>
          <p className="text-gray-600 mt-2">
            Give the rally a name. You&apos;ll add its stages and answer keys next.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
          <label htmlFor="rallyName" className="block text-lg font-medium mb-2 text-gray-800">
            Rally Name
          </label>
          <input
            type="text"
            id="rallyName"
            className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg text-gray-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring Rally 2026"
            required
          />
          <div className="text-right mt-6">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-lg shadow-md transition duration-150 disabled:opacity-60"
            >
              {submitting ? 'Creating...' : 'Create Rally'}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <Link href="/rallies" className="text-blue-600 hover:underline">
            &larr; Back to Rallies
          </Link>
        </div>
      </div>
    </div>
  );
}
