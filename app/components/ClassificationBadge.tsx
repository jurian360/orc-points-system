import React from 'react';
import type { ClassificationValue } from '../lib/participants';

interface ClassificationBadgeProps {
  classification?: ClassificationValue | string;
  // What to show when no class has been recorded for this participant.
  fallback?: string;
}

// The class letter of a participant, as it is written on the entry list. An
// empty class is shown as a placeholder rather than as an empty cell, so a
// missing class reads as "not recorded yet" instead of as a rendering glitch.
const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({
  classification,
  fallback = '—',
}) => {
  if (!classification) {
    return <span className="text-base text-gray-400">{fallback}</span>;
  }

  return (
    <span
      className="inline-flex items-center justify-center min-w-8 px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-base font-bold"
      title={`Classification ${classification}`}
    >
      {classification}
    </span>
  );
};

export default ClassificationBadge;
