'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import RallyDetailsForm from '../../../components/RallyDetailsForm';

interface Rally {
  _id: string;
  name: string;
  code?: string;
}

// Correcting a rally after it was created: its name and its code.
//
// The code matters more than a name usually does — it is printed under every QR
// code of the rally and travels with a card the crews hand in — so the form
// says what changing it costs. See RallyDetailsForm.
export default function EditRallyPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  useEffect(() => {
    if (!rallyId) return;

    const fetchRally = async () => {
      try {
        const response = await fetch(`/api/rallies/${rallyId}`);
        if (!response.ok) throw new Error('Failed to fetch rally');
        setRally(await response.json());
      } catch (err) {
        console.error(err);
        setError('Failed to load this rally. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchRally();
  }, [rallyId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading rally...</p>
      </div>
    );
  }

  if (error || !rally) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg">
            Back to Rallies
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Edit Rally</h1>
          <p className="text-gray-600 mt-2">
            The name is for the officials; the code is what the crews and their app see.
          </p>
        </div>

        <RallyDetailsForm
          rallyId={rally._id}
          initial={{ name: rally.name, code: rally.code || '' }}
          submitLabel="Save Changes"
          onSaved={() => router.push(`/rallies/${rally._id}`)}
          onCancel={() => router.push(`/rallies/${rally._id}`)}
        />

        <div className="mt-6">
          <Link href={`/rallies/${rally._id}`} className="text-blue-600 hover:underline">
            &larr; Back to Rally
          </Link>
        </div>
      </div>
    </div>
  );
}
