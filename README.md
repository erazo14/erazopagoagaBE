# Erazo Pagoaga Wedding API

Fastify API for wedding guests and RSVP responses. It uses the existing `Wedding.guests` collection for guest rows and a separate `rsvp_responses` collection for responses.

## Configuration

- `MONGODB_URI` — MongoDB connection URI; store it as a secret in the backend deployment environment.
- `MONGODB_DB_NAME` — database name; defaults to `Wedding`.
- `ADMIN_API_KEY` — protects guest and RSVP administration endpoints. Admin routes return `503` if this is not configured.
- `PORT` — optional server port; defaults to `3000`.
- `HOST` — optional bind address; defaults to `0.0.0.0`.

The API adds indexes to `Wedding.guests` and creates an index for `rsvp_responses`. It does not rewrite or delete existing guest records.

## Existing guest structure

Every document in `guests` represents one guest. MongoDB's `_id` identifies that guest, while `id` is the shared invitation/group relation.

| Field | Meaning |
| --- | --- |
| `_id` | MongoDB ID of this guest row |
| `id` | Shared relation ID for all guests in one invitation |
| `invitado2` | Guest's name |
| `ubicacion` | Where the guest lives |
| `novio` | Host who invited the group, such as `Fernando` |
| `categoria` | `Amigos`, `Amigos papás novia`, `Amigos papás novio`, `Familia`, or `Trabajo` |
| `bebida` | `Si` or `No`; stored per guest |
| `contacto` | Phone/contact for the principal guest |
| `principal` | `Si` for the recipient of the invitation, otherwise `No` |
| `prefijo` | Personal title such as `Sr.`, `Srta.`, or `Sra.` |
| `invitados` | Maximum invited count, stored only on the principal row and including the principal |
| `tipo` | `Acompañante`, `Familia`, `Individual`, or `Pareja` |
| `guestId` | Opaque invitation token, added to the principal row for public links |
| `active` | Optional archive flag; existing rows without this field are treated as active |

Existing numeric group IDs remain supported. Newly created groups use a generated string relation ID. The principal's `invitados` value is the RSVP limit; the response count is stored separately and cannot increase that limit.

The API recognizes `Sr.`/`Srta.`/`Sra.` as `prefijo` (a personal title), and treats `contacto` as one phone/contact string. It does not assume that `prefijo` is a telephone country code.

## Routes

Admin routes require the `x-admin-api-key` header.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/guest-groups` | Admin | Create a group and its principal/companions in `guests` |
| `GET` | `/api/guest-groups` | Admin | List active groups, guests, and RSVP status |
| `GET` | `/api/guest-groups/:id` | Admin | Get a group by its shared relation ID |
| `PATCH` | `/api/guest-groups/:id` | Admin | Update host, category, type, guest limit, or contact |
| `DELETE` | `/api/guest-groups/:id` | Admin | Archive all guest rows in a group |
| `POST` | `/api/guest-groups/:id/guests` | Admin | Add a guest within the invitation limit |
| `PATCH` | `/api/guest-groups/:id/guests/:guestId` | Admin | Update a guest's name, location, alcohol preference, or title |
| `PUT` | `/api/guest-groups/:id/principal` | Admin | Change the principal and its WhatsApp contact |
| `DELETE` | `/api/guest-groups/:id/guests/:guestId` | Admin | Archive a non-principal guest |
| `POST` | `/api/guest-groups/:id/invite-link` | Admin | Get or generate the group's invitation token |
| `GET` | `/api/invites/:guestId` | Public | Get safe invitation details and the current RSVP |
| `POST` | `/api/rsvps/:guestId` | Public | Submit or update the group's RSVP |
| `GET` | `/api/rsvps` | Admin | List submitted RSVP responses |

### Create invitation example

```json
{
  "principal": {
    "invitado2": "Invitado principal",
    "ubicacion": "Honduras",
    "bebida": "Si",
    "prefijo": "Sr."
  },
  "companions": [
    {
      "invitado2": "Acompañante",
      "ubicacion": "Honduras",
      "bebida": "No",
      "prefijo": "Srta."
    }
  ],
  "novio": "Fernando",
  "categoria": "Amigos",
  "tipo": "Pareja",
  "invitados": 2,
  "contacto": "+50400000000"
}
```

The response contains `guestId` and `inviteApiPath`. The frontend can place the token in the guest-facing invitation URL and use the public API path to load its details.

### Submit RSVP example

```json
{
  "status": "attending",
  "guestCount": 2,
  "attendeeNames": ["Invitado principal", "Acompañante"],
  "note": "Gracias por la invitación"
}
```

Use `status: "declined"` and `guestCount: 0` when the group cannot attend. `attendeeNames` is optional; when provided, its length must match `guestCount`.

## Development

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```
