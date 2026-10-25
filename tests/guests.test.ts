import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCreateGroup, parseRSVP} from '../src/routes/guest-validation';

const validGroup = {
  principal: {
    invitado2: 'Invitado principal',
    ubicacion: 'Honduras',
    bebida: 'Si',
    prefijo: 'Sr.',
  },
  companions: [
    {
      invitado2: 'Acompañante',
      ubicacion: 'Honduras',
      bebida: 'No',
      prefijo: 'Srta.',
    },
  ],
  novio: 'Fernando',
  categoria: 'Amigos',
  tipo: 'Pareja',
  invitados: 2,
  contacto: '+50400000000',
};

test('accepts a group whose listed guests fit the invitation limit', () => {
  const parsed = parseCreateGroup(validGroup);
  assert.ok(parsed);
  assert.equal(parsed.companions.length, 1);
  assert.equal(parsed.maxGuests, 2);
  assert.equal(parsed.principal.drinksAlcohol, true);
  assert.equal(parsed.principal.salutation, 'Sr.');
  assert.equal(parsed.host, 'Fernando');
  assert.equal(parsed.category, 'Amigos');
  assert.equal(parsed.contact, '+50400000000');
});

test('rejects a couple invitation with a limit other than two', () => {
  assert.equal(
    parseCreateGroup({...validGroup, invitados: 3, companions: []}),
    null,
  );
});

test('rejects more listed guests than the invitation allows', () => {
  assert.equal(
    parseCreateGroup({
      ...validGroup,
      companions: [{invitado2: 'Acompañante 1'}, {invitado2: 'Acompañante 2'}],
    }),
    null,
  );
});

test('accepts an individual invitation with exactly one seat', () => {
  const parsed = parseCreateGroup({
    ...validGroup,
    companions: [],
    tipo: 'Individual',
    invitados: 1,
  });
  assert.ok(parsed);
  assert.equal(parsed.maxGuests, 1);
  assert.equal(parsed.invitationType, 'Individual');
});

test('accepts an attending response with the principal included in guestCount', () => {
  assert.deepEqual(
    parseRSVP({
      status: 'attending',
      guestCount: 2,
      attendeeNames: ['Ana', 'Luis'],
    }),
    {
      status: 'attending',
      guestCount: 2,
      attendeeNames: ['Ana', 'Luis'],
    },
  );
});

test('rejects RSVP counts and attendee names that do not match', () => {
  assert.equal(parseRSVP({status: 'attending', guestCount: 0}), null);
  assert.equal(
    parseRSVP({
      status: 'attending',
      guestCount: 2,
      attendeeNames: ['Ana'],
    }),
    null,
  );
  assert.equal(parseRSVP({status: 'declined', guestCount: 1}), null);
});
