import {timingSafeEqual, randomBytes} from 'node:crypto';
import type {FastifyPluginAsync, FastifyReply, FastifyRequest} from 'fastify';
import {ObjectId, type Collection, type Db, type Filter} from 'mongodb';
import {env} from '../config/env';
import {connectMongoDB} from '../db/mongodb';
import {
  isYes,
  normalizeCategory,
  normalizeInvitationType,
  parseCreateGroup,
  parseGuest,
  parseRSVP,
  type GuestInput,
  type GuestCategory,
  type InvitationType,
  type RSVPStatus,
} from './guest-validation';

type GroupKey = string | number;
type YesNo = 'Si' | 'No';

interface GuestDocument {
  id: GroupKey;
  invitado2: string;
  ubicacion?: string;
  novio: string;
  categoria: string;
  bebida: YesNo;
  contacto?: string;
  principal: YesNo;
  prefijo?: string;
  invitados?: number;
  tipo: string;
  guestId?: string;
  active?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  archivedAt?: Date;
}

type StoredGuest = GuestDocument & {_id: ObjectId};

interface RSVPDocument {
  principalGuestId: ObjectId;
  invitationGroupId: GroupKey;
  status: RSVPStatus;
  guestCount: number;
  attendeeNames: string[];
  note?: string;
  respondedAt: Date;
  updatedAt: Date;
}

interface GroupParams {
  id: string;
}

interface GuestParams extends GroupParams {
  guestId: string;
}

interface InviteParams {
  guestId: string;
}

interface PrincipalBody {
  guestId: string;
  contact: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidObjectId = (value: string): boolean => ObjectId.isValid(value);

function guestCollection(db: Db): Collection<GuestDocument> {
  return db.collection<GuestDocument>('guests');
}

function rsvpCollection(db: Db): Collection<RSVPDocument> {
  return db.collection<RSVPDocument>('rsvp_responses');
}

function activeGroupFilter(id: GroupKey): Filter<GuestDocument> {
  return {
    id,
    active: {$ne: false},
  };
}

function groupCacheKey(id: GroupKey): string {
  return `${typeof id}:${id}`;
}

function groupIdForUrl(id: GroupKey): string {
  return String(id);
}

function asGuestInput(guest: GuestDocument): GuestInput {
  return {
    name: guest.invitado2,
    location: guest.ubicacion,
    drinksAlcohol: isYes(guest.bebida),
    salutation: guest.prefijo,
  };
}

function guestOutput(guest: StoredGuest, principalId: ObjectId | null) {
  return {
    id: guest._id.toString(),
    groupId: groupIdForUrl(guest.id),
    name: guest.invitado2,
    location: guest.ubicacion,
    drinksAlcohol: isYes(guest.bebida),
    salutation: guest.prefijo,
    isPrincipal: principalId?.equals(guest._id) ?? isYes(guest.principal),
  };
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    guestCollection(db).createIndex(
      {guestId: 1},
      {
        unique: true,
        name: 'guest_invite_token_unique',
        partialFilterExpression: {guestId: {$type: 'string'}},
      },
    ),
    guestCollection(db).createIndex(
      {id: 1, principal: 1, active: 1},
      {name: 'guests_by_invitation_group'},
    ),
    rsvpCollection(db).createIndex(
      {principalGuestId: 1},
      {unique: true, name: 'one_rsvp_per_principal'},
    ),
  ]);
}

function adminGuard(request: FastifyRequest, reply: FastifyReply): void {
  const expected = env.ADMIN_API_KEY;
  if (!expected) {
    reply.code(503).send({error: 'Admin API is not configured'});
    return;
  }

  const providedHeader = request.headers['x-admin-api-key'];
  const provided = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader;
  if (!provided) {
    reply.code(401).send({error: 'Unauthorized'});
    return;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    reply.code(401).send({error: 'Unauthorized'});
  }
}

async function findGroupRows(db: Db, id: string): Promise<StoredGuest[]> {
  const stringIdRows = await guestCollection(db)
    .find(activeGroupFilter(id))
    .sort({principal: -1, _id: 1})
    .toArray();
  if (stringIdRows.length || !/^\d+$/.test(id)) {
    return stringIdRows;
  }

  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) {
    return [];
  }
  return guestCollection(db)
    .find(activeGroupFilter(numericId))
    .sort({principal: -1, _id: 1})
    .toArray();
}

function getPrincipal(
  guests: StoredGuest[],
): StoredGuest | null {
  return guests.find((guest) => isYes(guest.principal)) ?? null;
}

async function getAdminGroup(
  db: Db,
  groupId: GroupKey,
  rows?: StoredGuest[],
) {
  const guests: StoredGuest[] =
    rows ??
    (await guestCollection(db)
      .find({
        ...activeGroupFilter(groupId),
      })
      .sort({_id: 1})
      .toArray());
  const principal = getPrincipal(guests);
  const rsvp = principal
    ? await rsvpCollection(db).findOne({principalGuestId: principal._id})
    : null;
  const firstGuest = guests[0];
  const capacity =
    principal && Number.isInteger(principal.invitados)
    ? (principal.invitados as number)
    : guests.length;

  return {
    id: groupIdForUrl(groupId),
    guestId: principal?.guestId ?? null,
    host: principal?.novio ?? firstGuest?.novio ?? '',
    category: normalizeCategory(principal?.categoria) ?? principal?.categoria ?? '',
    invitationType:
      normalizeInvitationType(principal?.tipo) ?? principal?.tipo ?? '',
    maxGuests: capacity,
    principalGuestId: principal?._id.toString() ?? null,
    contact: principal?.contacto ?? '',
    active: true,
    guests: guests.map((guest) => guestOutput(guest, principal?._id ?? null)),
    rsvp: rsvp
      ? {
          status: rsvp.status,
          guestCount: rsvp.guestCount,
          attendeeNames: rsvp.attendeeNames,
          note: rsvp.note,
          respondedAt: rsvp.respondedAt,
        }
      : {status: 'pending' as const, guestCount: 0, attendeeNames: []},
    createdAt: principal?.createdAt ?? firstGuest?.createdAt,
    updatedAt: principal?.updatedAt ?? firstGuest?.updatedAt,
  };
}

function parseContactUpdate(body: Record<string, unknown>): string | null {
  const value = body.contact ?? body.contacto;
  if (typeof value === 'string' && value.trim().length <= 40) {
    return value.trim();
  }
  return null;
}

function getGroupField(
  body: Record<string, unknown>,
  englishKey: string,
  spanishKey: string,
  current: unknown,
): unknown {
  return body[englishKey] !== undefined
    ? body[englishKey]
    : body[spanishKey] !== undefined
      ? body[spanishKey]
      : current;
}

const guestRoutes: FastifyPluginAsync = async (app) => {
  const db = await connectMongoDB();
  await ensureIndexes(db);

  app.post('/guest-groups', {preHandler: adminGuard}, async (request, reply) => {
    const input = parseCreateGroup(request.body);
    if (!input) {
      app.log.warn('Rejected invalid guest group payload');
      return reply.code(400).send({error: 'Invalid guest group. Check the guest and invitation fields.'});
    }

    const groupId = new ObjectId().toHexString();
    const now = new Date();
    const guestId = randomBytes(32).toString('base64url');
    const toDocument = (
      guest: GuestInput,
      principal: boolean,
    ): GuestDocument => ({
      id: groupId,
      invitado2: guest.name,
      ubicacion: guest.location,
      novio: input.host,
      categoria: input.category,
      bebida: guest.drinksAlcohol ? 'Si' : 'No',
      contacto: principal ? input.contact : '',
      principal: principal ? 'Si' : 'No',
      prefijo: guest.salutation,
      ...(principal ? {invitados: input.maxGuests, guestId} : {}),
      tipo: input.invitationType,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const documents = [
      toDocument(input.principal, true),
      ...input.companions.map((guest) => toDocument(guest, false)),
    ];

    app.log.info(
      {groupId, guestCount: documents.length},
      'Inserting guest group into MongoDB',
    );
    try {
      await guestCollection(db).insertMany(documents);
    } catch (error) {
      app.log.error({err: error, groupId}, 'Guest group insert failed; attempting cleanup');
      await guestCollection(db).deleteMany({id: groupId});
      throw error;
    }

    app.log.info({groupId}, 'Guest records inserted; loading group response');
    const group = await getAdminGroup(db, groupId);
    app.log.info({groupId}, 'Guest group response loaded');
    return reply.code(201).send({
      ...group,
      inviteApiPath: `/api/invites/${guestId}`,
    });
  });

  app.get('/guest-groups', {preHandler: adminGuard}, async (_request, reply) => {
    app.log.info('Loading guest rows for admin list');
    const allGuests: StoredGuest[] = await guestCollection(db)
      .find({active: {$ne: false}, id: {$exists: true}})
      .sort({id: 1, _id: 1})
      .toArray();
    app.log.info({guestCount: allGuests.length}, 'Guest rows loaded; grouping invitations');
    const groups = new Map<string, {id: GroupKey; guests: StoredGuest[]}>();
    for (const guest of allGuests) {
      const key = groupCacheKey(guest.id);
      const group = groups.get(key) ?? {id: guest.id, guests: []};
      group.guests.push(guest);
      groups.set(key, group);
    }

    const result = await Promise.all(
      [...groups.values()].map((group) =>
        getAdminGroup(db, group.id, group.guests),
      ),
    );
    app.log.info({groupCount: result.length}, 'Admin guest groups loaded');
    return reply.send(result);
  });

  app.get<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Guest group not found'});
      }
      return reply.send(await getAdminGroup(db, rows[0].id, rows));
    },
  );

  app.patch<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isRecord(request.body)) {
        return reply.code(400).send({error: 'Invalid guest group update'});
      }
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Guest group not found'});
      }

      const groupId = rows[0].id;
      const principal = getPrincipal(rows);
      if (!principal) {
        return reply.code(409).send({error: 'This group has no principal guest'});
      }

      const hostValue = getGroupField(request.body, 'host', 'novio', principal.novio);
      const category = normalizeCategory(
        getGroupField(request.body, 'category', 'categoria', principal.categoria),
      );
      const invitationType = normalizeInvitationType(
        getGroupField(request.body, 'invitationType', 'tipo', principal.tipo),
      );
      const maxGuestsValue = getGroupField(
        request.body,
        'maxGuests',
        'invitados',
        principal.invitados,
      );
      const contact = parseContactUpdate(request.body);
      const hasContactUpdate =
        request.body.contact !== undefined || request.body.contacto !== undefined;

      if (
        typeof hostValue !== 'string' ||
        !hostValue.trim() ||
        hostValue.trim().length > 120 ||
        !category ||
        !invitationType ||
        !Number.isInteger(maxGuestsValue) ||
        (maxGuestsValue as number) < 1 ||
        (maxGuestsValue as number) > 20 ||
        (hasContactUpdate && contact === null)
      ) {
        return reply.code(400).send({error: 'Invalid host, category, invitation type, guest limit, or contact'});
      }

      const maxGuests = maxGuestsValue as number;
      if (
        (invitationType === 'Individual' && maxGuests !== 1) ||
        ((invitationType === 'Pareja' || invitationType === 'Acompañante') &&
          maxGuests !== 2) ||
        rows.length > maxGuests
      ) {
        return reply.code(400).send({error: 'Guest limit does not match the invitation or listed guests'});
      }

      const commonUpdate = {
        novio: hostValue.trim(),
        categoria: category,
        tipo: invitationType,
        updatedAt: new Date(),
      };
      await guestCollection(db).updateMany(
        activeGroupFilter(groupId),
        {$set: commonUpdate},
      );
      await guestCollection(db).updateOne(
        {_id: principal._id},
        {
          $set: {
            invitados: maxGuests,
            ...(hasContactUpdate ? {contacto: contact ?? ''} : {}),
            updatedAt: new Date(),
          },
        },
      );

      return reply.send(await getAdminGroup(db, groupId));
    },
  );

  app.delete<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      app.log.info(
        {groupId: request.params.id},
        'Looking up guest group for invitation link',
      );
      const rows = await findGroupRows(db, request.params.id);
      app.log.info(
        {groupId: request.params.id, guestCount: rows.length},
        'Invitation link group lookup complete',
      );
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      await guestCollection(db).updateMany(
        activeGroupFilter(rows[0].id),
        {$set: {active: false, archivedAt: new Date(), updatedAt: new Date()}},
      );
      return reply.code(204).send();
    },
  );

  app.post<{Params: GroupParams}>(
    '/guest-groups/:id/guests',
    {preHandler: adminGuard},
    async (request, reply) => {
      const guest = parseGuest(request.body);
      if (!guest) {
        return reply.code(400).send({error: 'Invalid guest data'});
      }
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const principal = getPrincipal(rows);
      if (!principal) {
        return reply.code(409).send({error: 'This group has no principal guest'});
      }
      const maxGuests = Number.isInteger(principal.invitados)
        ? (principal.invitados as number)
        : rows.length;
      if (rows.length >= maxGuests) {
        return reply.code(409).send({error: 'Guest group has reached its invitation limit'});
      }

      const now = new Date();
      const result = await guestCollection(db).insertOne({
        id: principal.id,
        invitado2: guest.name,
        ubicacion: guest.location,
        novio: principal.novio,
        categoria: principal.categoria,
        bebida: guest.drinksAlcohol ? 'Si' : 'No',
        contacto: '',
        principal: 'No',
        prefijo: guest.salutation,
        tipo: principal.tipo,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      return reply.code(201).send({
        id: result.insertedId.toString(),
        groupId: groupIdForUrl(principal.id),
        name: guest.name,
        location: guest.location,
        drinksAlcohol: guest.drinksAlcohol,
        salutation: guest.salutation,
        isPrincipal: false,
      });
    },
  );

  app.patch<{Params: GuestParams}>(
    '/guest-groups/:id/guests/:guestId',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.guestId) || !isRecord(request.body)) {
        return reply.code(400).send({error: 'Invalid guest update'});
      }
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const guestId = new ObjectId(request.params.guestId);
      const guestExists = rows.some((guest) => guest._id.equals(guestId));
      if (!guestExists) {
        return reply.code(404).send({error: 'Guest not found in this group'});
      }

      const parsedGuest = parseGuest({
        ...request.body,
        name: request.body.name ?? request.body.invitado2 ?? 'placeholder',
      });
      if (!parsedGuest) {
        return reply.code(400).send({error: 'Invalid guest fields'});
      }

      const updates: Record<string, unknown> = {updatedAt: new Date()};
      if (request.body.name !== undefined || request.body.invitado2 !== undefined) {
        updates.invitado2 = parsedGuest.name;
      }
      if (request.body.location !== undefined || request.body.ubicacion !== undefined) {
        updates.ubicacion = parsedGuest.location ?? '';
      }
      if (
        request.body.drinksAlcohol !== undefined ||
        request.body.bebida !== undefined
      ) {
        updates.bebida = parsedGuest.drinksAlcohol ? 'Si' : 'No';
      }
      if (request.body.salutation !== undefined || request.body.prefijo !== undefined) {
        updates.prefijo = parsedGuest.salutation ?? '';
      }
      if (Object.keys(updates).length === 1) {
        return reply.code(400).send({error: 'No editable guest fields were provided'});
      }

      const result = await guestCollection(db).updateOne(
        {
          _id: guestId,
          id: rows[0].id,
          active: {$ne: false},
        },
        {$set: updates},
      );
      if (!result.matchedCount) {
        return reply.code(404).send({error: 'Active guest not found'});
      }

      const updated = await guestCollection(db).findOne({_id: guestId});
      const principal = getPrincipal(rows);
      return reply.send(updated ? guestOutput(updated, principal?._id ?? null) : null);
    },
  );

  app.put<{Params: GroupParams}>(
    '/guest-groups/:id/principal',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (
        !isRecord(request.body) ||
        typeof request.body.guestId !== 'string' ||
        !isValidObjectId(request.body.guestId)
      ) {
        return reply.code(400).send({error: 'A valid guestId is required'});
      }
      const contact = parseContactUpdate(request.body);
      if (contact === null || !contact) {
        return reply.code(400).send({error: 'A valid contact is required'});
      }

      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const nextPrincipalId = new ObjectId(request.body.guestId);
      const nextPrincipal = rows.find((guest) => guest._id.equals(nextPrincipalId));
      if (!nextPrincipal) {
        return reply.code(404).send({error: 'Guest not found in this group'});
      }
      const oldPrincipal = getPrincipal(rows);
      const maxGuests = oldPrincipal?.invitados ?? rows.length;
      const guestId = randomBytes(32).toString('base64url');
      const groupId = rows[0].id;

      await guestCollection(db).updateMany(
        {id: groupId, active: {$ne: false}},
        {
          $set: {principal: 'No', updatedAt: new Date()},
          $unset: {invitados: '', contacto: '', guestId: ''},
        },
      );
      await guestCollection(db).updateOne(
        {_id: nextPrincipalId, id: groupId},
        {
          $set: {
            principal: 'Si',
            invitados: maxGuests,
            contacto: contact,
            guestId,
            updatedAt: new Date(),
          },
        },
      );

      return reply.send({
        ...(await getAdminGroup(db, groupId)),
        inviteApiPath: `/api/invites/${guestId}`,
      });
    },
  );

  app.delete<{Params: GuestParams}>(
    '/guest-groups/:id/guests/:guestId',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.guestId)) {
        return reply.code(400).send({error: 'Invalid guest id'});
      }
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const guestId = new ObjectId(request.params.guestId);
      const principal = getPrincipal(rows);
      if (principal?._id.equals(guestId)) {
        return reply.code(400).send({error: 'The principal guest cannot be removed'});
      }
      const result = await guestCollection(db).updateOne(
        {
          _id: guestId,
          id: rows[0].id,
          active: {$ne: false},
        },
        {$set: {active: false, archivedAt: new Date(), updatedAt: new Date()}},
      );
      if (!result.matchedCount) {
        return reply.code(404).send({error: 'Active guest not found'});
      }
      return reply.code(204).send();
    },
  );

  app.post<{Params: GroupParams}>(
    '/guest-groups/:id/invite-link',
    {preHandler: adminGuard},
    async (request, reply) => {
      const rows = await findGroupRows(db, request.params.id);
      if (!rows.length) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const principal = getPrincipal(rows);
      if (!principal) {
        return reply.code(409).send({error: 'This group has no principal guest'});
      }
      const guestId = principal.guestId ?? randomBytes(32).toString('base64url');
      if (!principal.guestId) {
        app.log.info(
          {groupId: request.params.id},
          'Saving invitation token for guest group',
        );
        await guestCollection(db).updateOne(
          {_id: principal._id},
          {$set: {guestId, updatedAt: new Date()}},
        );
        app.log.info(
          {groupId: request.params.id},
          'Invitation token saved for guest group',
        );
      }
      return reply.send({
        guestId,
        inviteApiPath: `/api/invites/${guestId}`,
      });
    },
  );

  app.get<{Params: InviteParams}>('/invites/:guestId', async (request, reply) => {
    const principal = await guestCollection(db).findOne({
      guestId: request.params.guestId,
      principal: 'Si',
      active: {$ne: false},
    });
    if (!principal) {
      return reply.code(404).send({error: 'Invitation not found'});
    }

    const rows = await guestCollection(db)
      .find({id: principal.id, active: {$ne: false}})
      .toArray();
    const rsvp = await rsvpCollection(db).findOne({principalGuestId: principal._id});
    const maxGuests = Number.isInteger(principal.invitados)
      ? (principal.invitados as number)
      : rows.length;
    return reply.send({
      guestId: principal.guestId,
      principal: {
        name: principal.invitado2,
        salutation: principal.prefijo,
      },
      invitationType:
        normalizeInvitationType(principal.tipo) ?? principal.tipo,
      maxGuests,
      rsvp: rsvp
        ? {
            status: rsvp.status,
            guestCount: rsvp.guestCount,
            attendeeNames: rsvp.attendeeNames,
            note: rsvp.note,
            respondedAt: rsvp.respondedAt,
          }
        : {status: 'pending', guestCount: 0, attendeeNames: []},
    });
  });

  app.post<{Params: InviteParams}>('/rsvps/:guestId', async (request, reply) => {
    const response = parseRSVP(request.body);
    if (!response) {
      return reply.code(400).send({error: 'Invalid RSVP response'});
    }
    const principal = await guestCollection(db).findOne({
      guestId: request.params.guestId,
      principal: 'Si',
      active: {$ne: false},
    });
    if (!principal) {
      return reply.code(404).send({error: 'Invitation not found'});
    }

    const maxGuests = Number.isInteger(principal.invitados)
      ? (principal.invitados as number)
      : 1;
    if (response.guestCount > maxGuests) {
      return reply.code(400).send({
        error: `guestCount cannot exceed the invitation limit of ${maxGuests}`,
      });
    }

    const now = new Date();
    await rsvpCollection(db).updateOne(
      {principalGuestId: principal._id},
      {
        $set: {
          principalGuestId: principal._id,
          invitationGroupId: principal.id,
          ...response,
          respondedAt: now,
          updatedAt: now,
        },
      },
      {upsert: true},
    );
    return reply.send({
      status: response.status,
      guestCount: response.guestCount,
      attendeeNames: response.attendeeNames,
      respondedAt: now,
    });
  });

  app.get('/rsvps', {preHandler: adminGuard}, async (_request, reply) => {
    const responses = await rsvpCollection(db)
      .find()
      .sort({respondedAt: -1})
      .toArray();
    const result = await Promise.all(
      responses.map(async (response) => {
        const principal = await guestCollection(db).findOne({
          _id: response.principalGuestId,
        });
        return {
          id: response._id.toString(),
          invitationGroupId: groupIdForUrl(response.invitationGroupId),
          guestId: principal?.guestId,
          principalName: principal?.invitado2,
          status: response.status,
          guestCount: response.guestCount,
          attendeeNames: response.attendeeNames,
          note: response.note,
          respondedAt: response.respondedAt,
        };
      }),
    );
    return reply.send(result);
  });
};

export default guestRoutes;
