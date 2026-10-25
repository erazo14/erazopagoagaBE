import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCreateGroup, parseRSVP} from '../src/routes/guest-validation';

const validGroup = {
  principal: {name: 'Ana', drinksAlcohol: false, location: 'Tegucigalpa'},
  companions: [{name: 'Luis', drinksAlcohol: true}],
  invitedBy: 'novia',
  category: 'amigos',
  invitationType: 'pareja',
  maxGuests: 2,
  contact: {countryPrefix: '+504', phoneNumber: '9999-1234'},
};

test('accepts a group whose listed guests fit the invitation limit', () => {
  const parsed = parseCreateGroup(validGroup);
  assert.ok(parsed);
  assert.equal(parsed.companions.length, 1);
  assert.equal(parsed.maxGuests, 2);
  assert.equal(parsed.principal.drinksAlcohol, false);
});

test('rejects a couple invitation with a limit other than two', () => {
  assert.equal(
    parseCreateGroup({...validGroup, maxGuests: 3, companions: []}),
    null,
  );
});

test('rejects more listed guests than the invitation allows', () => {
  assert.equal(
    parseCreateGroup({
      ...validGroup,
      companions: [{name: 'Luis'}, {name: 'Marta'}],
    }),
    null,
  );
});

test('accepts an individual invitation with exactly one seat', () => {
  const parsed = parseCreateGroup({
    ...validGroup,
    companions: [],
    invitationType: 'individual',
    maxGuests: 1,
  });
  assert.ok(parsed);
  assert.equal(parsed.maxGuests, 1);
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
