// A **person**: one human being who rides rallies, across every rally and every
// season. It is the record the rest of this feature hangs off — a crew is two
// of these, an overall standing is the same two of these turning up together
// three times — and it is deliberately *not* a per-rally row: the whole point
// is that the same person is recognisable from one event to the next.
//
// **The e-mail address is the identity.** It is what an official looks a person
// up by, what a participant signs in with, and what the unique index is on.
// Everything else about a person — their name included — can be corrected
// without making them somebody else. An e-mail *change* is therefore an
// ordinary edit of one field on one document (nothing else stores it), which is
// what makes "change the address and the data follows" true by construction
// rather than by a migration.
//
// Pure and shared, client + server, like `standings.ts` and `routes.ts`: the
// admin form validates an address, a fuel type and a phone number with the same
// rules the API enforces, so a value the form accepts is never refused by the
// server.

import type { ClassificationValue } from './participants';

// --- E-mail -----------------------------------------------------------------

export const MAX_EMAIL_LENGTH = 254; // the RFC's limit on an address

// Deliberately permissive: one `@`, something either side, a dot in the domain
// and no whitespace. A stricter pattern rejects addresses that work, and the
// only thing this app does with the address is identify a person — it never
// sends to it, so a typo is a support question, not a security hole.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Addresses are stored lower-cased and trimmed, so the unique index means what
// it says: `Jan@Example.com` and `jan@example.com` are one person. The local
// part of an address is case-sensitive in the RFC and in no mail server anybody
// runs; treating them as two people would be the real bug.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export const EMAIL_RULE = 'Enter an e-mail address, e.g. jan@example.com.';

// --- Vehicle ----------------------------------------------------------------

// What a car runs on. A short closed list rather than free text: it is read as
// a group ("how many diesels are in the field") and a typed-in fuel type is a
// column of near-duplicates within two events.
export const FUEL_TYPES = ['Gasoline', 'Diesel', 'LPG', 'Hybrid', 'Electric', 'Other'] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

export type FuelTypeValue = FuelType | '';

export function isFuelType(value: unknown): value is FuelType {
  return typeof value === 'string' && (FUEL_TYPES as readonly string[]).includes(value);
}

// The car a crew registers for **one rally**. It lives on the registration
// rather than on a person because a crew turns up in whatever car they have
// that weekend, and last year's entry should keep saying which car actually
// rode it.
export interface Vehicle {
  brand: string;
  model: string;
  licensePlate: string;
  fuelType: FuelTypeValue;
  insurer: string;
}

export const EMPTY_VEHICLE: Vehicle = {
  brand: '',
  model: '',
  licensePlate: '',
  fuelType: '',
  insurer: '',
};

// True once the car is identifiable — brand, model and plate. Registration does
// not block on it (an entry list arrives before the cars do), but the entry is
// shown as incomplete until it is filled in.
export function isVehicleComplete(vehicle: Vehicle | null | undefined): boolean {
  if (!vehicle) return false;
  return Boolean(vehicle.brand.trim() && vehicle.model.trim() && vehicle.licensePlate.trim());
}

// "Toyota Corolla (PK-12-34)", or as much of it as is known. Empty when nothing
// about the car has been recorded, so callers can fall back to a placeholder.
export function vehicleLabel(vehicle: Vehicle | null | undefined): string {
  if (!vehicle) return '';
  const name = [vehicle.brand, vehicle.model].map((part) => part.trim()).filter(Boolean).join(' ');
  const plate = vehicle.licensePlate.trim();
  if (name && plate) return `${name} (${plate})`;
  return name || plate;
}

// --- Phone ------------------------------------------------------------------

export const MAX_PHONE_LENGTH = 32;

// Digits, spaces and the punctuation a written number carries. Not parsed into
// a country code: Suriname's numbers are handed round as people write them, and
// normalising them would only lose the way an official recognises one.
const PHONE_PATTERN = /^[0-9+()\-. ]{4,32}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

export const PHONE_RULE = 'Use digits, spaces and + ( ) - only.';

// --- The person -------------------------------------------------------------

export const MAX_FOOD_RESTRICTIONS_LENGTH = 500;

// One entry in a person's classification history. Written every time the class
// on the record actually changes, never on a save that leaves it alone, so the
// list reads as "what happened to this rider" rather than as an audit of who
// pressed Save.
export interface ClassificationChange {
  // The class the person held before this change; '' for the first one ever
  // recorded.
  from: ClassificationValue;
  to: ClassificationValue;
  changedAt: string;
  // The username of the official who made the change, for the question that
  // always follows a promotion ("who moved them up, and when").
  changedBy: string;
}

export interface Person {
  _id: string;
  email: string;
  name: string;
  phone: string;
  foodRestrictions: string;
  classification: ClassificationValue;
  // When the class on the record was last changed — the head of `history`,
  // denormalised so a list of 200 riders can show it without sending every
  // person's whole history down the wire.
  classificationChangedAt: string | null;
  classificationHistory: ClassificationChange[];
  // Whether this person can sign in. The password itself never leaves the API.
  hasLogin: boolean;
  createdAt: string;
  updatedAt: string;
}

// A person as a picker or a crew line shows them: enough to recognise who this
// is without the contact details.
export interface PersonSummary {
  _id: string;
  email: string;
  name: string;
  classification: ClassificationValue;
}

// The name, falling back to the address. A person is created from an entry list
// that sometimes has only one of the two, and an empty cell in a crew line is a
// worse answer than the address they were entered under.
export function personLabel(person: { name?: string; email?: string } | null | undefined): string {
  if (!person) return '';
  return person.name?.trim() || person.email?.trim() || '';
}

// Does this person match what an official typed into a search box? Name and
// address both, because an official looking for "jan" may be reading either off
// the entry list in front of them.
export function personMatches(person: PersonSummary, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle)
  );
}
