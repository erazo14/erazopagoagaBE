# Erazo Pagoaga Wedding API

Fastify API for managing invitation groups and their RSVP responses.

## Configuration

Set these environment variables before starting the server:

- `MONGODB_URI` — MongoDB connection URI.
- `ADMIN_API_KEY` — required to use guest-management and RSVP administration routes. Admin routes return `503` when this is not configured.
- `PORT` — optional server port; defaults to `3000`.
- `HOST` — optional bind address; defaults to `0.0.0.0`.

The API creates the `guest_groups`, `guests`, and `rsvp_responses` collections and their indexes when it starts. It does not modify other collections.

## Guest and invitation model

- A guest group represents one invitation and has a MongoDB `_id`.
- Each guest record has its own MongoDB `_id` and a `groupId` reference to the invitation group.
- Exactly one guest is the principal recipient. The group stores the WhatsApp contact's `countryPrefix` and `phoneNumber`.
- The group receives an opaque `guestId` token. Use the returned token in the frontend invitation URL and fetch its public details from `GET /api/invites/:guestId`.
- `maxGuests` is the maximum number of people who may attend, including the principal. An RSVP cannot change this limit.
- `drinksAlcohol` is a boolean on each guest.
- Categories: `amigos`, `amigos_papas_novia`, `amigos_papas_novio`, `familia`, `trabajo`.
- `invitedBy`: `novia` or `novio`.
- Invitation types: `individual` (one seat), `acompanante` (two seats), `pareja` (two seats), or `familia` (one to twenty seats).
- Archived groups and guests are retained instead of physically deleted.

## Routes

Admin routes require the `x-admin-api-key` header.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/guest-groups` | Admin | Create an invitation group and its principal/companions |
| `GET` | `/api/guest-groups` | Admin | List active groups, guests, and RSVP status |
| `GET` | `/api/guest-groups/:id` | Admin | Get a group by MongoDB id |
| `PATCH` | `/api/guest-groups/:id` | Admin | Update host, category, type, limit, or contact |
| `DELETE` | `/api/guest-groups/:id` | Admin | Archive a group |
| `POST` | `/api/guest-groups/:id/guests` | Admin | Add a guest to a group |
| `PATCH` | `/api/guest-groups/:id/guests/:guestId` | Admin | Update a guest's name, location, or alcohol preference |
| `PUT` | `/api/guest-groups/:id/principal` | Admin | Change the principal recipient and WhatsApp contact |
| `DELETE` | `/api/guest-groups/:id/guests/:guestId` | Admin | Archive a non-principal guest |
| `GET` | `/api/invites/:guestId` | Public | Get safe invitation details and the current RSVP |
| `POST` | `/api/rsvps/:guestId` | Public | Submit or update the group's RSVP |
| `GET` | `/api/rsvps` | Admin | List submitted RSVP responses |

### Create invitation example

```json
{
  "principal": {
    "name": "Ana Pérez",
    "location": "Tegucigalpa",
    "drinksAlcohol": false
  },
  "companions": [
    {
      "name": "Luis Gómez",
      "drinksAlcohol": true
    }
  ],
  "invitedBy": "novia",
  "category": "amigos",
  "invitationType": "pareja",
  "maxGuests": 2,
  "contact": {
    "countryPrefix": "+504",
    "phoneNumber": "9999-1234"
  }
}
```

The creation response includes the generated `guestId` and `inviteApiPath`. The frontend can include that token in the guest-facing invitation URL.

### Submit RSVP example

```json
{
  "status": "attending",
  "guestCount": 2,
  "attendeeNames": ["Ana Pérez", "Luis Gómez"],
  "note": "Gracias por la invitación"
}
```

Use `status: "declined"` and `guestCount: 0` when the group cannot attend. `attendeeNames` is optional; when provided, its length must match `guestCount`.

## Development

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
```
