import 'server-only';

// Registering a crew for a rally: turning two rider ids off the wire into the
// entry that is stored.
//
// One module because the two routes that do it — `POST` on the rally's
// participants and `PUT` on one EQ of it — have to derive exactly the same
// entry from the same body, and because what is derived is the part a client
// may not send: a crew's class is the higher of its two riders' and the names
// are copies of theirs, so accepting either from the browser would let a form
// claim a class its riders do not hold.

import mongoose from 'mongoose';

import dbConnect from './mongodb';
import { Person } from '../models';
import { crewClassification, type ClassificationValue } from './participants';
import { parseObjectId, parseVehicle } from './validation';
import { EMPTY_VEHICLE, type Vehicle } from './persons';

export interface CrewFields {
  driverId: string | null;
  navigatorId: string | null;
  driverName: string;
  navigatorName: string;
  driverClassification: ClassificationValue;
  navigatorClassification: ClassificationValue;
  classification: ClassificationValue;
  vehicle: Vehicle;
}

export type CrewResult =
  | { ok: true; crew: CrewFields }
  | { ok: false; error: string };

// Read a crew off a request body.
//
// **Both seats or neither.** An entry with one rider named is not half a crew,
// it is an entry that cannot be scored as one: the overall standings group on
// the pair, and a pair with a hole in it silently drops out of every season it
// rode. The one exception is an entry with *no* riders at all, which is what an
// entry-list import produces before anybody has been registered and what the
// form then fills in — that stays allowed, and such an entry is simply not part
// of a season.
export async function readCrew(body: Record<string, unknown>): Promise<CrewResult> {
  const vehicle = parseVehicle(body.vehicle);
  if (!vehicle) {
    return { ok: false, error: 'The vehicle details are not valid' };
  }

  const hasDriver = body.driverId !== undefined && body.driverId !== null && body.driverId !== '';
  const hasNavigator =
    body.navigatorId !== undefined && body.navigatorId !== null && body.navigatorId !== '';

  if (!hasDriver && !hasNavigator) {
    return {
      ok: true,
      crew: {
        driverId: null,
        navigatorId: null,
        driverName: '',
        navigatorName: '',
        driverClassification: '',
        navigatorClassification: '',
        classification: '',
        vehicle,
      },
    };
  }

  if (!hasDriver || !hasNavigator) {
    return {
      ok: false,
      error: 'A crew needs both a driver and a navigator, or neither.',
    };
  }

  // Proving both are scalar object ids is what keeps `{"$in": []}` out of the
  // lookup below and out of the unique index that stops a rider being entered
  // twice.
  const driverId = parseObjectId(body.driverId);
  const navigatorId = parseObjectId(body.navigatorId);
  if (!driverId || !navigatorId) {
    return { ok: false, error: 'Pick the driver and the navigator from the riders' };
  }

  if (driverId === navigatorId) {
    return { ok: false, error: 'The driver and the navigator have to be two different riders' };
  }

  await dbConnect();

  // Both ids went through `parseObjectId` above, so this `$in` holds two
  // proven scalars; `mongoose.trusted` is what gets it past `sanitizeFilter`
  // (app/lib/mongodb.ts), which would otherwise wrap it in an `$eq`.
  const riders = (await Person.find(
    { _id: mongoose.trusted({ $in: [driverId, navigatorId] }) },
    'name classification'
  ).lean()) as unknown as {
    _id: unknown;
    name: string;
    classification?: ClassificationValue;
  }[];

  const byId = new Map(riders.map((rider) => [String(rider._id), rider]));
  const driver = byId.get(driverId);
  const navigator = byId.get(navigatorId);

  if (!driver || !navigator) {
    return { ok: false, error: 'One of these riders is not in the register' };
  }

  const driverClassification = driver.classification || '';
  const navigatorClassification = navigator.classification || '';

  return {
    ok: true,
    crew: {
      driverId,
      navigatorId,
      // Copies of the riders' names as they stand today. Kept fresh by
      // `PUT /api/persons/[id]`, which rewrites them when a rider is renamed.
      driverName: driver.name,
      navigatorName: navigator.name,
      driverClassification,
      navigatorClassification,
      // Derived, never sent: the class of a crew is the higher of its two
      // riders' on B < A < H.
      classification: crewClassification(driverClassification, navigatorClassification),
      vehicle,
    },
  };
}

// The 11000 a crew registration can hit, in words. There are three unique
// indexes in play and they fail for three different reasons, so one message
// for all of them would send an official looking in the wrong place.
export function duplicateCrewMessage(error: unknown): string {
  const key = (error as { keyPattern?: Record<string, unknown> })?.keyPattern ?? {};

  if ('driverId' in key) return 'That driver is already entered in this rally';
  if ('navigatorId' in key) return 'That navigator is already entered in this rally';
  return 'This rally already has a participant with this EQ number';
}

export { EMPTY_VEHICLE };
