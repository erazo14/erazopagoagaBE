export const GUEST_CATEGORIES = [
  'amigos',
  'amigos_papas_novia',
  'amigos_papas_novio',
  'familia',
  'trabajo',
] as const;

export const INVITATION_TYPES = [
  'acompanante',
  'familia',
  'individual',
  'pareja',
] as const;

export const INVITED_BY = ['novia', 'novio'] as const;

export type GuestCategory = (typeof GUEST_CATEGORIES)[number];
export type InvitationType = (typeof INVITATION_TYPES)[number];
export type InvitedBy = (typeof INVITED_BY)[number];
export type RSVPStatus = 'attending' | 'declined';

export interface GuestInput {
  name: string;
  location?: string;
  drinksAlcohol: boolean;
}

export interface CreateGuestGroupInput {
  principal: GuestInput;
  companions: GuestInput[];
  invitedBy: InvitedBy;
  category: GuestCategory;
  invitationType: InvitationType;
  maxGuests: number;
  contact: {
    countryPrefix: string;
    phoneNumber: string;
  };
}

export interface RSVPBody {
  status: RSVPStatus;
  guestCount: number;
  attendeeNames?: string[];
  note?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOneOf = <T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] => typeof value === 'string' && values.includes(value);

export function parseGuest(value: unknown): GuestInput | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  const name = value.name.trim();
  if (name.length < 1 || name.length > 120) {
    return null;
  }

  let location: string | undefined;
  if (value.location !== undefined) {
    if (typeof value.location !== 'string' || value.location.trim().length > 120) {
      return null;
    }
    location = value.location.trim() || undefined;
  }

  if (value.drinksAlcohol !== undefined && typeof value.drinksAlcohol !== 'boolean') {
    return null;
  }

  return {
    name,
    ...(location ? {location} : {}),
    drinksAlcohol: value.drinksAlcohol === true,
  };
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

  if (
    !isOneOf(INVITED_BY, value.invitedBy) ||
    !isOneOf(GUEST_CATEGORIES, value.category) ||
    !isOneOf(INVITATION_TYPES, value.invitationType) ||
    !Number.isInteger(value.maxGuests) ||
    (value.maxGuests as number) < 1 ||
    (value.maxGuests as number) > 20 ||
    !isRecord(value.contact)
  ) {
    return null;
  }

  const countryPrefix = value.contact.countryPrefix;
  const phoneNumber = value.contact.phoneNumber;
  if (
    typeof countryPrefix !== 'string' ||
    !/^\+\d{1,4}$/.test(countryPrefix.trim()) ||
    typeof phoneNumber !== 'string' ||
    !/^[\d\s()-]{5,24}$/.test(phoneNumber.trim()) ||
    phoneNumber.replace(/\D/g, '').length < 5 ||
    phoneNumber.replace(/\D/g, '').length > 15
  ) {
    return null;
  }

  const maxGuests = value.maxGuests as number;
  const invitationType = value.invitationType;
  if (
    (invitationType === 'individual' && maxGuests !== 1) ||
    ((invitationType === 'acompanante' || invitationType === 'pareja') &&
      maxGuests !== 2) ||
    companions.length + 1 > maxGuests
  ) {
    return null;
  }

  return {
    principal,
    companions: companions as GuestInput[],
    invitedBy: value.invitedBy,
    category: value.category,
    invitationType,
    maxGuests,
    contact: {
      countryPrefix: countryPrefix.trim(),
      phoneNumber: phoneNumber.trim(),
    },
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
        (name) => typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120,
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
  if (
    (value.status === 'declined' && guestCount !== 0) ||
    (value.status === 'attending' && guestCount < 1) ||
    (Array.isArray(attendeeNames) && attendeeNames.length !== guestCount)
  ) {
    return null;
  }

  return {
    status: value.status,
    guestCount,
    ...(Array.isArray(attendeeNames)
      ? {attendeeNames: attendeeNames.map((name) => (name as string).trim())}
      : {attendeeNames: []}),
    ...(typeof value.note === 'string' && value.note.trim()
      ? {note: value.note.trim()}
      : {}),
  };
}
