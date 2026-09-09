import React, { useState } from 'react';

import type { RallyRoute } from '../lib/routes';

// The routes of a rally: its sequential legs, managed in place under the stage
// list they group.
//
// Most rallies have none and never will, so this panel is not a tab and not a
// page of its own — it is opened from the Stages tab and closed again, the way
// the entry-list import is. On a rally with no routes the whole feature is one
// admin-only button, and the stage list below reads exactly as it always did.
//
// Everything here is an admin's (`manage:rally`): a leg boundary is where the
// time delta is neutralised, so moving one moves the delta of the whole field.
// The panel is only rendered for an admin and every route the buttons call is
// guarded — hiding a button is never the control.

// A route as this panel reads it: the rally's own list, plus how many stages it
// holds, which is what decides whether it can be deleted.
export interface ManagedRoute extends RallyRoute {
  stageCount?: number;
}

interface RouteManagerPanelProps {
  rallyId: string;
  routes: ManagedRoute[];
  // Stages of a rally that has routes but sit in none. The API does not allow
  // it, so this is normally 0 — it is surfaced rather than hidden because a
  // document edited straight in the database can produce one, and such a stage
  // is ridden as a leg of its own ahead of route 1.
  unassignedStages?: number;
  // Reload the dashboard: a route change re-scores the rally, so the stage list
  // and the standings above and below this panel are both stale after one.
  onChanged: () => void;
  onClose: () => void;
}

const RouteManagerPanel: React.FC<RouteManagerPanelProps> = ({
  rallyId,
  routes,
  unassignedStages = 0,
  onChanged,
  onClose,
}) => {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One request per action, and the panel reloads the dashboard after each: a
  // route change re-scores the rally, so there is nothing to batch and nothing
  // that may be left un-reloaded.
  const send = async (
    url: string,
    options: RequestInit,
    onFail: (payload: any, status: number) => string
  ) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(onFail(payload, response.status));
        return false;
      }
      onChanged();
      return true;
    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    // The first route is the leg the rally's stages were already typed as, so
    // they all move into it. Said before the request, because it is the one
    // action here that changes stages the official did not name.
    if (routes.length === 0) {
      const confirmed = window.confirm(
        `Add the first route to this rally?\n\n` +
          `Every stage it already has moves into "${name}", in running order — you can ` +
          `move them from there once you add a second route. The scores are recalculated.`
      );
      if (!confirmed) return;
    }

    const ok = await send(
      `/api/rallies/${rallyId}/routes`,
      { method: 'POST', body: JSON.stringify({ name }) },
      (payload) => payload.error || 'Could not add the route.'
    );
    if (ok) setNewName('');
  };

  const handleRename = async (routeId: string) => {
    const name = renameName.trim();
    if (!name) return;

    const ok = await send(
      `/api/rallies/${rallyId}/routes/${routeId}`,
      { method: 'PUT', body: JSON.stringify({ name }) },
      (payload) => payload.error || 'Could not rename the route.'
    );
    if (ok) setRenaming(null);
  };

  const handleDelete = async (route: ManagedRoute) => {
    const confirmed = window.confirm(
      `Delete route "${route.name}"?\n\n` +
        `Its place in the running order goes. No stage and no answer sheet is touched.` +
        (routes.length === 1
          ? `\n\nThis is the last route, so the rally goes back to being one continuous leg.`
          : '')
    );
    if (!confirmed) return;

    await send(
      `/api/rallies/${rallyId}/routes/${route._id}`,
      { method: 'DELETE' },
      (payload, status) =>
        status === 409 && Array.isArray(payload.stages)
          ? `${payload.error}: ${payload.stages
              .map((stage: any) => stage.name)
              .join(', ')}.`
          : payload.error || 'Could not delete the route.'
    );
  };

  // Reorder sends the whole order rather than one route's place: the places are
  // only meaningful against each other, and the API requires every route exactly
  // once so two legs can never claim the same place.
  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= routes.length) return;

    const order = routes.map((route) => route._id);
    [order[index], order[target]] = [order[target], order[index]];

    await send(
      `/api/rallies/${rallyId}/routes`,
      { method: 'PUT', body: JSON.stringify({ routeIds: order }) },
      (payload) => payload.error || 'Could not reorder the routes.'
    );
  };

  return (
    <div className="border-2 border-indigo-200 bg-indigo-50 rounded-lg p-5 mb-6">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Routes</h3>
          <p className="text-sm text-gray-700 mt-1 max-w-3xl">
            Routes are the sequential legs of the rally: every crew rides route 1, then
            route 2. A route holds its own stages and its first stage starts free — the
            time delta is neutralised at the boundary — and the results carry a ranking
            per route beside the rally ranking. Only the finish of the last stage of the
            last route disqualifies.
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 font-medium text-sm transition-colors"
        >
          Close
        </button>
      </div>

      {error && (
        <p className="text-red-700 bg-red-100 border border-red-300 rounded px-3 py-2 text-sm font-medium mb-3">
          {error}
        </p>
      )}

      {unassignedStages > 0 && (
        <p className="text-amber-800 bg-amber-100 border border-amber-300 rounded px-3 py-2 text-sm font-medium mb-3">
          {unassignedStages} stage{unassignedStages === 1 ? '' : 's'} of this rally
          {unassignedStages === 1 ? ' is' : ' are'} in no route, so{' '}
          {unassignedStages === 1 ? 'it is' : 'they are'} ridden as a leg of their own
          ahead of route 1. Give {unassignedStages === 1 ? 'it' : 'them'} a route on the
          stage&apos;s Edit page.
        </p>
      )}

      {routes.length === 0 ? (
        <p className="text-sm text-gray-700 mb-4">
          No routes — this rally is one continuous leg and reads exactly as it does now.
          Add a route only for an event that is ridden in separate legs.
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {routes.map((route, index) => (
            <li
              key={route._id}
              className="bg-white border border-gray-200 rounded px-3 py-2 flex flex-wrap items-center gap-3"
            >
              <span className="text-gray-400 font-medium w-6">{index + 1}.</span>

              {renaming === route._id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleRename(route._id);
                  }}
                  className="flex flex-wrap items-center gap-2 flex-1"
                >
                  <input
                    type="text"
                    className="flex-1 min-w-[12rem] px-3 py-1.5 border border-gray-300 rounded text-base text-gray-800"
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    maxLength={200}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={busy || !renameName.trim()}
                    className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 font-medium text-sm transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="font-semibold text-gray-900 flex-1">{route.name}</span>
                  <span className="text-sm text-gray-600">
                    {route.stageCount || 0} stage{route.stageCount === 1 ? '' : 's'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMove(index, -1)}
                      disabled={busy || index === 0}
                      title="Move this route earlier in the rally"
                      className="px-2 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm transition-colors disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMove(index, 1)}
                      disabled={busy || index === routes.length - 1}
                      title="Move this route later in the rally"
                      className="px-2 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm transition-colors disabled:opacity-30"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => {
                        setRenaming(route._id);
                        setRenameName(route.name);
                      }}
                      disabled={busy}
                      className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 font-medium text-sm transition-colors disabled:opacity-50"
                    >
                      Rename
                    </button>
                    {/* A route can only go once it is empty. Deleting a stage
                        takes its answer sheets with it, and a mis-click on a
                        grouping must never be able to do that. */}
                    <button
                      onClick={() => handleDelete(route)}
                      disabled={busy || Boolean(route.stageCount)}
                      title={
                        route.stageCount
                          ? `This route still holds ${route.stageCount} stage${
                              route.stageCount === 1 ? '' : 's'
                            }. Move them to another route first — deleting a route never deletes a stage.`
                          : 'Delete this route'
                      }
                      className="px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium text-sm transition-colors disabled:opacity-30"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="flex-1 min-w-[14rem] px-3 py-2 border border-gray-300 rounded text-base text-gray-800"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={routes.length === 0 ? 'e.g. Ochtendroute' : 'e.g. Middagroute'}
          maxLength={200}
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-base transition-colors disabled:opacity-50"
        >
          Add Route
        </button>
      </form>

      {routes.length > 0 && (
        <p className="text-xs text-gray-600 mt-3">
          A stage is moved between routes on its own Edit page. Delete every route and
          this rally reads exactly as a rally without routes again.
        </p>
      )}
    </div>
  );
};

export default RouteManagerPanel;
