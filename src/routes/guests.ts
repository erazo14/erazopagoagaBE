import {timingSafeEqual, randomBytes} from 'node:crypto';
import type {FastifyPluginAsync, FastifyReply, FastifyRequest} from 'fastify';
import {ObjectId, type Collection, type Db, type WithId} from 'mongodb';
import {env} from '../config/env';
import {connectMongoDB} from '../db/mongodb';
import {
  GUEST_CATEGORIES,
  INVITATION_TYPES,
  INVITED_BY,
  parseCreateGroup,
  parseGuest,
  parseRSVP,
  type GuestInput,
  type GuestCategory,
  type InvitationType,
  type InvitedBy,
  type RSVPStatus,
} from './guest-validation';

interface GuestGroupDocument {
  guestId: string;
  invitedBy: InvitedBy;
  category: GuestCategory;
  invitationType: InvitationType;
  maxGuests: number;
  principalGuestId: ObjectId;
  contact: {
    countryPrefix: string;
    phoneNumber: string;
  };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

interface GuestDocument extends GuestInput {
  groupId: ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

interface RSVPDocument {
  invitationGroupId: ObjectId;
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

interface GuestParams {
  id: string;
  guestId: string;
}

interface InviteParams {
  guestId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOneOf = <T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] => typeof value === 'string' && values.includes(value);

const isValidObjectId = (value: string): boolean => ObjectId.isValid(value);

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<GuestGroupDocument>('guest_groups').createIndex(
      {guestId: 1},
      {unique: true, name: 'guest_id_unique'},
    ),
    db.collection<GuestDocument>('guests').createIndex(
      {groupId: 1, active: 1},
      {name: 'guests_by_group'},
    ),
    db.collection<RSVPDocument>('rsvp_responses').createIndex(
      {invitationGroupId: 1},
      {unique: true, name: 'one_rsvp_per_invitation'},
    ),
  ]);
}

function adminGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
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

function groupCollection(db: Db): Collection<GuestGroupDocument> {
  return db.collection<GuestGroupDocument>('guest_groups');
}

function guestCollection(db: Db): Collection<GuestDocument> {
  return db.collection<GuestDocument>('guests');
}

function rsvpCollection(db: Db): Collection<RSVPDocument> {
  return db.collection<RSVPDocument>('rsvp_responses');
}

async function getAdminGroup(db: Db, group: WithId<GuestGroupDocument>) {
  const [guests, rsvp] = await Promise.all([
    guestCollection(db)
      .find({groupId: group._id, active: true})
      .toArray(),
    rsvpCollection(db).findOne({invitationGroupId: group._id}),
  ]);

  return {
    id: group._id.toString(),
    guestId: group.guestId,
    invitedBy: group.invitedBy,
    category: group.category,
    invitationType: group.invitationType,
    maxGuests: group.maxGuests,
    principalGuestId: group.principalGuestId.toString(),
    contact: group.contact,
    active: group.active,
    guests: guests.map((guest) => ({
      id: guest._id.toString(),
      groupId: guest.groupId.toString(),
      name: guest.name,
      location: guest.location,
      drinksAlcohol: guest.drinksAlcohol,
      isPrincipal: guest._id.equals(group.principalGuestId),
    })),
    rsvp: rsvp
      ? {
          status: rsvp.status,
          guestCount: rsvp.guestCount,
          attendeeNames: rsvp.attendeeNames,
          note: rsvp.note,
          respondedAt: rsvp.respondedAt,
        }
      : {status: 'pending' as const, guestCount: 0, attendeeNames: []},
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

const guestRoutes: FastifyPluginAsync = async (app) => {
  const db = await connectMongoDB();
  await ensureIndexes(db);

  app.post('/guest-groups', {preHandler: adminGuard}, async (request, reply) => {
    const input = parseCreateGroup(request.body);
    if (!input) {
      return reply.code(400).send({error: 'Invalid guest group. Check fields and invitation limits.'});
    }

    const now = new Date();
    const groupId = new ObjectId();
    const principalGuestId = new ObjectId();
    const guestId = randomBytes(32).toString('base64url');
    const group: GuestGroupDocument & {_id: ObjectId} = {
      _id: groupId,
      guestId,
      invitedBy: input.invitedBy,
      category: input.category,
      invitationType: input.invitationType,
      maxGuests: input.maxGuests,
      principalGuestId,
      contact: input.contact,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const guests: Array<GuestDocument & {_id: ObjectId}> = [
      {
        _id: principalGuestId,
        ...input.principal,
        groupId,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      ...input.companions.map((guest) => ({
        _id: new ObjectId(),
        ...guest,
        groupId,
        active: true,
        createdAt: now,
        updatedAt: now,
      })),
    ];

    await groupCollection(db).insertOne(group);
    try {
      await guestCollection(db).insertMany(guests);
    } catch (error) {
      await guestCollection(db).deleteMany({groupId});
      await groupCollection(db).deleteOne({_id: groupId});
      throw error;
    }

    return reply.code(201).send({
      ...(await getAdminGroup(db, group)),
      inviteApiPath: `/api/invites/${guestId}`,
    });
  });

  app.get('/guest-groups', {preHandler: adminGuard}, async (_request, reply) => {
    const groups = await groupCollection(db)
      .find({active: true})
      .sort({createdAt: -1})
      .toArray();
    return reply.send(await Promise.all(groups.map((group) => getAdminGroup(db, group))));
  });

  app.get<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id)) {
        return reply.code(400).send({error: 'Invalid guest group id'});
      }

      const group = await groupCollection(db).findOne({
        _id: new ObjectId(request.params.id),
      });
      if (!group) {
        return reply.code(404).send({error: 'Guest group not found'});
      }

      return reply.send(await getAdminGroup(db, group));
    },
  );

  app.patch<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id) || !isRecord(request.body)) {
        return reply.code(400).send({error: 'Invalid guest group update'});
      }

      const groupId = new ObjectId(request.params.id);
      const group = await groupCollection(db).findOne({_id: groupId});
      if (!group) {
        return reply.code(404).send({error: 'Guest group not found'});
      }

      const updates: Partial<
        Pick<GuestGroupDocument, 'invitedBy' | 'category' | 'invitationType' | 'maxGuests' | 'contact'>
      > = {};
      const body = request.body;

      if (body.invitedBy !== undefined) {
        if (!isOneOf(INVITED_BY, body.invitedBy)) {
          return reply.code(400).send({error: 'Invalid invitedBy value'});
        }
        updates.invitedBy = body.invitedBy;
      }
      if (body.category !== undefined) {
        if (!isOneOf(GUEST_CATEGORIES, body.category)) {
          return reply.code(400).send({error: 'Invalid category value'});
        }
        updates.category = body.category;
      }
      if (body.invitationType !== undefined) {
        if (!isOneOf(INVITATION_TYPES, body.invitationType)) {
          return reply.code(400).send({error: 'Invalid invitationType value'});
        }
        updates.invitationType = body.invitationType;
      }
      if (body.maxGuests !== undefined) {
        if (
          !Number.isInteger(body.maxGuests) ||
          (body.maxGuests as number) < 1 ||
          (body.maxGuests as number) > 20
        ) {
          return reply.code(400).send({error: 'maxGuests must be between 1 and 20'});
        }
        updates.maxGuests = body.maxGuests as number;
      }
      if (body.contact !== undefined) {
        if (!isRecord(body.contact)) {
          return reply.code(400).send({error: 'Invalid contact'});
        }
        const candidate = parseCreateGroup({
          principal: {name: 'Validation'},
          invitedBy: group.invitedBy,
          category: group.category,
          invitationType: group.invitationType,
          maxGuests: group.maxGuests,
          contact: body.contact,
        });
        if (!candidate) {
          return reply.code(400).send({error: 'Invalid contact'});
        }
        updates.contact = candidate.contact;
      }

      const newInvitationType = updates.invitationType ?? group.invitationType;
      const newMaxGuests = updates.maxGuests ?? group.maxGuests;
      if (
        (newInvitationType === 'individual' && newMaxGuests !== 1) ||
        ((newInvitationType === 'acompanante' || newInvitationType === 'pareja') &&
          newMaxGuests !== 2)
      ) {
        return reply.code(400).send({error: 'maxGuests does not match invitationType'});
      }

      const activeGuestCount = await guestCollection(db).countDocuments({
        groupId,
        active: true,
      });
      if (activeGuestCount > newMaxGuests) {
        return reply.code(400).send({error: 'maxGuests cannot be lower than the number of listed guests'});
      }

      await groupCollection(db).updateOne(
        {_id: groupId},
        {$set: {...updates, updatedAt: new Date()}},
      );
      const updated = await groupCollection(db).findOne({_id: groupId});
      return reply.send(updated ? await getAdminGroup(db, updated) : null);
    },
  );

  app.delete<{Params: GroupParams}>(
    '/guest-groups/:id',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id)) {
        return reply.code(400).send({error: 'Invalid guest group id'});
      }

      const result = await groupCollection(db).updateOne(
        {_id: new ObjectId(request.params.id), active: true},
        {$set: {active: false, archivedAt: new Date(), updatedAt: new Date()}},
      );
      if (!result.matchedCount) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      return reply.code(204).send();
    },
  );

  app.post<{Params: GroupParams}>(
    '/guest-groups/:id/guests',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id)) {
        return reply.code(400).send({error: 'Invalid guest group id'});
      }
      const guest = parseGuest(request.body);
      if (!guest) {
        return reply.code(400).send({error: 'Invalid guest data'});
      }

      const groupId = new ObjectId(request.params.id);
      const group = await groupCollection(db).findOne({_id: groupId, active: true});
      if (!group) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }
      const count = await guestCollection(db).countDocuments({groupId, active: true});
      if (count >= group.maxGuests) {
        return reply.code(409).send({error: 'Guest group has reached its invitation limit'});
      }

      const now = new Date();
      const result = await guestCollection(db).insertOne({
        ...guest,
        groupId,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      return reply.code(201).send({
        id: result.insertedId.toString(),
        groupId: groupId.toString(),
        ...guest,
        isPrincipal: false,
      });
    },
  );

  app.patch<{Params: GuestParams}>(
    '/guest-groups/:id/guests/:guestId',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id) || !isValidObjectId(request.params.guestId)) {
        return reply.code(400).send({error: 'Invalid guest or group id'});
      }
      if (!isRecord(request.body)) {
        return reply.code(400).send({error: 'Invalid guest update'});
      }
      const group = await groupCollection(db).findOne({
        _id: new ObjectId(request.params.id),
        active: true,
      });
      if (!group) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }

      const updates: Partial<GuestInput> = {};
      if (request.body.name !== undefined) {
        if (
          typeof request.body.name !== 'string' ||
          !request.body.name.trim() ||
          request.body.name.trim().length > 120
        ) {
          return reply.code(400).send({error: 'Invalid guest name'});
        }
        updates.name = request.body.name.trim();
      }
      if (request.body.location !== undefined) {
        if (typeof request.body.location !== 'string' || request.body.location.trim().length > 120) {
          return reply.code(400).send({error: 'Invalid guest location'});
        }
        updates.location = request.body.location.trim();
      }
      if (request.body.drinksAlcohol !== undefined) {
        if (typeof request.body.drinksAlcohol !== 'boolean') {
          return reply.code(400).send({error: 'drinksAlcohol must be a boolean'});
        }
        updates.drinksAlcohol = request.body.drinksAlcohol;
      }
      if (!Object.keys(updates).length) {
        return reply.code(400).send({error: 'No editable guest fields were provided'});
      }

      const result = await guestCollection(db).findOneAndUpdate(
        {
          _id: new ObjectId(request.params.guestId),
          groupId: new ObjectId(request.params.id),
          active: true,
        },
        {$set: {...updates, updatedAt: new Date()}},
        {returnDocument: 'after'},
      );
      if (!result) {
        return reply.code(404).send({error: 'Active guest not found'});
      }
      return reply.send({
        id: result._id.toString(),
        groupId: result.groupId.toString(),
        name: result.name,
        location: result.location,
        drinksAlcohol: result.drinksAlcohol,
        isPrincipal: result._id.equals(group.principalGuestId),
      });
    },
  );

  app.put<{Params: GroupParams}>(
    '/guest-groups/:id/principal',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id) || !isRecord(request.body)) {
        return reply.code(400).send({error: 'Invalid principal guest update'});
      }
      if (
        typeof request.body.guestId !== 'string' ||
        !isValidObjectId(request.body.guestId) ||
        !isRecord(request.body.contact)
      ) {
        return reply.code(400).send({error: 'guestId and contact are required'});
      }

      const groupId = new ObjectId(request.params.id);
      const group = await groupCollection(db).findOne({_id: groupId, active: true});
      if (!group) {
        return reply.code(404).send({error: 'Active guest group not found'});
      }

      const nextPrincipalId = new ObjectId(request.body.guestId);
      const nextPrincipal = await guestCollection(db).findOne({
        _id: nextPrincipalId,
        groupId,
        active: true,
      });
      if (!nextPrincipal) {
        return reply.code(404).send({error: 'Active guest not found in this group'});
      }

      const contact = parseCreateGroup({
        principal: {name: 'Validation'},
        invitedBy: group.invitedBy,
        category: group.category,
        invitationType: group.invitationType,
        maxGuests: group.maxGuests,
        contact: request.body.contact,
      })?.contact;
      if (!contact) {
        return reply.code(400).send({error: 'Invalid contact'});
      }

      await groupCollection(db).updateOne(
        {_id: groupId},
        {$set: {principalGuestId: nextPrincipalId, contact, updatedAt: new Date()}},
      );

      const updated = await groupCollection(db).findOne({_id: groupId});
      return reply.send(updated ? await getAdminGroup(db, updated) : null);
    },
  );

  app.delete<{Params: GuestParams}>(
    '/guest-groups/:id/guests/:guestId',
    {preHandler: adminGuard},
    async (request, reply) => {
      if (!isValidObjectId(request.params.id) || !isValidObjectId(request.params.guestId)) {
        return reply.code(400).send({error: 'Invalid guest or group id'});
      }
      const groupId = new ObjectId(request.params.id);
      const guestId = new ObjectId(request.params.guestId);
      const group = await groupCollection(db).findOne({_id: groupId});
      if (!group) {
        return reply.code(404).send({error: 'Guest group not found'});
      }
      if (group.principalGuestId.equals(guestId)) {
        return reply.code(400).send({error: 'The principal guest cannot be removed'});
      }

      const result = await guestCollection(db).updateOne(
        {_id: guestId, groupId, active: true},
        {$set: {active: false, archivedAt: new Date(), updatedAt: new Date()}},
      );
      if (!result.matchedCount) {
        return reply.code(404).send({error: 'Active guest not found'});
      }
      return reply.code(204).send();
    },
  );

  app.get<{Params: InviteParams}>('/invites/:guestId', async (request, reply) => {
    const group = await groupCollection(db).findOne({
      guestId: request.params.guestId,
      active: true,
    });
    if (!group) {
      return reply.code(404).send({error: 'Invitation not found'});
    }

    const principal = await guestCollection(db).findOne({
      _id: group.principalGuestId,
      groupId: group._id,
      active: true,
    });
    if (!principal) {
      return reply.code(404).send({error: 'Invitation not found'});
    }

    const rsvp = await rsvpCollection(db).findOne({invitationGroupId: group._id});
    return reply.send({
      guestId: group.guestId,
      principal: {name: principal.name},
      invitationType: group.invitationType,
      maxGuests: group.maxGuests,
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

    const group = await groupCollection(db).findOne({
      guestId: request.params.guestId,
      active: true,
    });
    if (!group) {
      return reply.code(404).send({error: 'Invitation not found'});
    }
    if (response.guestCount > group.maxGuests) {
      return reply.code(400).send({
        error: `guestCount cannot exceed the invitation limit of ${group.maxGuests}`,
      });
    }

    const now = new Date();
    await rsvpCollection(db).updateOne(
      {invitationGroupId: group._id},
      {
        $set: {
          invitationGroupId: group._id,
          ...response,
          respondedAt: now,
          updatedAt: now,
        },
      },
      {upsert: true},
    );

    return reply.code(200).send({
      status: response.status,
      guestCount: response.guestCount,
      attendeeNames: response.attendeeNames,
      respondedAt: now,
    });
  });

  app.get('/rsvps', {preHandler: adminGuard}, async (_request, reply) => {
    const responses = await rsvpCollection(db).find().sort({respondedAt: -1}).toArray();
    return reply.send(
      await Promise.all(
        responses.map(async (response) => {
          const group = await groupCollection(db).findOne({_id: response.invitationGroupId});
          const principal = group
            ? await guestCollection(db).findOne({
                _id: group.principalGuestId,
                groupId: group._id,
              })
            : null;
          return {
            id: response._id.toString(),
            invitationGroupId: response.invitationGroupId.toString(),
            guestId: group?.guestId,
            principalName: principal?.name,
            status: response.status,
            guestCount: response.guestCount,
            attendeeNames: response.attendeeNames,
            note: response.note,
            respondedAt: response.respondedAt,
          };
        }),
      ),
    );
  });
};

export default guestRoutes;
