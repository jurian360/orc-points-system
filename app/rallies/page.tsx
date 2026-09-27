'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../components/AuthContext';
import { copyRallyName } from '../lib/rallyCodes';
import { PAGE_CONTAINER } from '../lib/pageContainer';

interface Rally {
  _id: string;
  name: string;
  createdAt: string;
}

export default function RalliesPage() {
  // Creating and deleting a rally is an admin's. Hiding the buttons only keeps
  // a data-entry official from clicking what /api/rallies would refuse.
  const { can } = useAuth();
  const isAdmin = can('manage:rally');
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The rally a duplicate is being made of, and what the last one reported.
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const fetchRallies = async () => {
      try {
        const response = await fetch('/api/rallies');
        if (!response.ok) {
          throw new Error('Failed to fetch rallies');
        }
        const data = await response.json();
        setRallies(data);
      } catch (err) {
        setError('Failed to load rallies. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRallies();
  }, []);

  const handleDeleteRally = async (rallyId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this rally? All of its stages and answer sheets will also be deleted. This action cannot be undone.'
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/rallies/${rallyId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete rally');
      }
      setRallies(rallies.filter((rally) => rally._id !== rallyId));
    } catch (err) {
      alert('Failed to delete rally. Please try again.');
      console.error(err);
    }
  };

  // A new rally with the stages and the answer keys of this one — the work of
  // setting a rally up, which is the same every time the event is run. The
  // entry list, the answer sheets and the printed QR codes belong to *this*
  // running of it and are deliberately left behind.
  const handleDuplicateRally = async (rally: Rally) => {
    const name = copyRallyName(rally.name);
    if (
      !window.confirm(
        `Duplicate this rally as "${name}"? Its stages and their answer keys are copied. ` +
          'The participants, their answer sheets and the printed QR codes are not.'
      )
    ) {
      return;
    }

    setDuplicating(rally._id);
    setNotice(null);
    try {
      const response = await fetch(`/api/rallies/${rally._id}/duplicate`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to duplicate rally');
      }
      const data = await response.json();
      // The list is newest first, which is where a rally created just now goes.
      setRallies((current) => [data.rally, ...current]);
      setNotice(
        `Created "${data.rally.name}" with ${data.stages} stage${data.stages === 1 ? '' : 's'}. ` +
          'Import its entry list to start typing cards for it.'
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to duplicate rally. Please try again.');
      console.error(err);
    } finally {
      setDuplicating(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className={PAGE_CONTAINER}>
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Rally Management</h1>
          {isAdmin && (
            <Link
              href="/rallies/new"
              className="px-5 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-lg font-medium shadow-md transition duration-150"
            >
              Create New Rally
            </Link>
          )}
        </div>

        {notice && (
          <div className="mb-6 bg-green-100 border-l-4 border-green-500 text-green-800 px-6 py-3 text-base font-medium rounded">
            <p>{notice}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600">Loading rallies...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-lg text-red-600 font-medium">{error}</p>
            </div>
          ) : rallies.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600 mb-4">
                {isAdmin
                  ? 'No rallies found. Create your first rally to get started.'
                  : 'No rallies found. An admin creates the rally before cards can be typed.'}
              </p>
              {isAdmin && (
                <Link
                  href="/rallies/new"
                  className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 inline-block"
                >
                  Create New Rally
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Rally Name
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Created At
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rallies.map((rally) => (
                    <tr key={rally._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-lg font-medium text-gray-900">{rally.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-base text-gray-600">{formatDate(rally.createdAt)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex justify-end space-x-4">
                          <Link
                            href={`/rallies/${rally._id}`}
                            className="text-blue-600 hover:text-blue-900 font-medium text-base"
                          >
                            Open
                          </Link>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => handleDuplicateRally(rally)}
                                disabled={duplicating === rally._id}
                                title="Create a new rally with the stages and answer keys of this one"
                                className="text-indigo-600 hover:text-indigo-900 font-medium text-base disabled:opacity-60"
                              >
                                {duplicating === rally._id ? 'Duplicating…' : 'Duplicate'}
                              </button>
                              <button
                                onClick={() => handleDeleteRally(rally._id)}
                                className="text-red-600 hover:text-red-900 font-medium text-base"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-8">
          <Link href="/" className="text-blue-600 hover:underline text-lg font-medium">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
