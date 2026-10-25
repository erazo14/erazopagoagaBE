export const GUEST_CATEGORIES = [
  'Amigos',
  'Amigos papás novia',
  'Amigos papás novio',
  'Familia',
  'Trabajo',
] as const;

export const INVITATION_TYPES = [
  'Acompañante',
  'Familia',
  'Individual',
  'Pareja',
] as const;

export type GuestCategory = (typeof GUEST_CATEGORIES)[number];
export type InvitationType = (typeof INVITATION_TYPES)[number];
export type RSVPStatus = 'attending' | 'declined';

export interface GuestInput {
  name: string;
  location?: string;
  drinksAlcohol: boolean;
  salutation?: string;
}

export interface CreateGuestGroupInput {
  principal: GuestInput;
  companions: GuestInput[];
  host: string;
  category: GuestCategory;
  invitationType: InvitationType;
  maxGuests: number;
  contact: string;
}

export interface RSVPBody {
  status: RSVPStatus;
  guestCount: number;
  attendeeNames: string[];
  note?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const categoryLookup = new Map<string, GuestCategory>([
  ['amigos', 'Amigos'],
  ['amigos papas novia', 'Amigos papás novia'],
  ['amigos papas novio', 'Amigos papás novio'],
  ['familia', 'Familia'],
  ['trabajo', 'Trabajo'],
]);

const invitationTypeLookup = new Map<string, InvitationType>([
  ['acompanante', 'Acompañante'],
  ['familia', 'Familia'],
  ['individual', 'Individual'],
  ['pareja', 'Pareja'],
]);

export function normalizeCategory(value: unknown): GuestCategory | null {
  return typeof value === 'string'
    ? (categoryLookup.get(normalizeText(value)) ?? null)
    : null;
}

export function normalizeInvitationType(value: unknown): InvitationType | null {
  return typeof value === 'string'
    ? (invitationTypeLookup.get(normalizeText(value)) ?? null)
    : null;
}

function parseDrinksAlcohol(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeText(value);
  if (['si', 'yes', 'true', '1'].includes(normalized)) {
    return true;
  }
  if (['no', 'false', '0'].includes(normalized)) {
    return false;
  }
  return null;
}

function firstPresent(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

export function parseGuest(value: unknown): GuestInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawName = firstPresent(value, ['name', 'invitado2']);
  if (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 120) {
    return null;
  }

  const rawLocation = firstPresent(value, ['location', 'ubicacion']);
  if (
    rawLocation !== undefined &&
    (typeof rawLocation !== 'string' || rawLocation.trim().length > 120)
  ) {
    return null;
  }

  const rawDrinks = firstPresent(value, ['drinksAlcohol', 'bebida']);
  const drinksAlcohol = rawDrinks === undefined ? false : parseDrinksAlcohol(rawDrinks);
  if (drinksAlcohol === null) {
    return null;
  }

  const rawSalutation = firstPresent(value, ['salutation', 'prefijo']);
  if (
    rawSalutation !== undefined &&
    (typeof rawSalutation !== 'string' || rawSalutation.trim().length > 30)
  ) {
    return null;
  }

  return {
    name: rawName.trim(),
    ...(typeof rawLocation === 'string' && rawLocation.trim()
      ? {location: rawLocation.trim()}
      : {}),
    drinksAlcohol,
    ...(typeof rawSalutation === 'string' && rawSalutation.trim()
      ? {salutation: rawSalutation.trim()}
      : {}),
  };
}

function parseContact(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length <= 40 ? value.trim() : null;
  }
  if (!isRecord(value)) {
    return null;
  }

  const phoneNumber = value.phoneNumber;
  const countryPrefix = value.countryPrefix;
  if (
    typeof phoneNumber !== 'string' ||
    (countryPrefix !== undefined && typeof countryPrefix !== 'string')
  ) {
    return null;
  }
  const contact = `${typeof countryPrefix === 'string' ? countryPrefix.trim() : ''}${phoneNumber.trim()}`;
  return contact.length <= 40 ? contact : null;
}

export function parseCreateGroup(value: unknown): CreateGuestGroupInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const principal = parseGuest(value.principal);
  const companionsInput = value.companions === undefined ? [] : value.companions;
  if (!principal || !Array.isArray(companionsInput)) {
    return null;
  }

  const companions = companionsInput.map(parseGuest);
  if (companions.some((guest) => guest === null)) {
    return null;
  }

  const hostValue = firstPresent(value, ['host', 'novio', 'invitedBy']);
  const category = normalizeCategory(firstPresent(value, ['category', 'categoria']));
  const invitationType = normalizeInvitationType(
    firstPresent(value, ['invitationType', 'tipo']),
  );
  const maxGuests = firstPresent(value, ['maxGuests', 'invitados']);
  const contact = parseContact(firstPresent(value, ['contact', 'contacto']));

  if (
    typeof hostValue !== 'string' ||
    hostValue.trim().length < 1 ||
    hostValue.trim().length > 120 ||
    !category ||
    !invitationType ||
    !Number.isInteger(maxGuests) ||
    (maxGuests as number) < 1 ||
    (maxGuests as number) > 20 ||
    contact === null
  ) {
    return null;
  }

  const limit = maxGuests as number;
  if (
    (invitationType === 'Individual' && limit !== 1) ||
    ((invitationType === 'Acompañante' || invitationType === 'Pareja') && limit !== 2) ||
    companions.length + 1 > limit
  ) {
    return null;
  }

  return {
    principal,
    companions: companions as GuestInput[],
    host: hostValue.trim(),
    category,
    invitationType,
    maxGuests: limit,
    contact,
  };
}

export function parseRSVP(value: unknown): RSVPBody | null {
  if (
    !isRecord(value) ||
    (value.status !== 'attending' && value.status !== 'declined') ||
    !Number.isInteger(value.guestCount) ||
    (value.guestCount as number) < 0
  ) {
    return null;
  }

  const attendeeNames = value.attendeeNames;
  if (
    attendeeNames !== undefined &&
    (!Array.isArray(attendeeNames) ||
      attendeeNames.some(
        (name) =>
          typeof name !== 'string' ||
          name.trim().length < 1 ||
          name.trim().length > 120,
      ))
  ) {
    return null;
  }

  if (
    value.note !== undefined &&
    (typeof value.note !== 'string' || value.note.trim().length > 1000)
  ) {
    return null;
  }

  const guestCount = value.guestCount as number;
  const names = Array.isArray(attendeeNames)
    ? attendeeNames.map((name) => (name as string).trim())
    : [];
  if (
    (value.status === 'declined' && guestCount !== 0) ||
    (value.status === 'attending' && guestCount < 1) ||
    (Array.isArray(attendeeNames) && names.length !== guestCount)
  ) {
    return null;
  }

  return {
    status: value.status,
    guestCount,
    attendeeNames: names,
    ...(typeof value.note === 'string' && value.note.trim()
      ? {note: value.note.trim()}
      : {}),
  };
}

export function isYes(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    ['si', 'yes', 'true', '1'].includes(normalizeText(value))
  );
}
