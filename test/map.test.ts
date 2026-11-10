import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventId, mapCalendar, type Source } from '../src/map.ts';
import { diff } from '../src/sync.ts';

const source: Source = { key: 'nijmegen', name: 'VSA Nijmegen', icsUrl: 'https://example.invalid/x.ics' };

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nX-WR-TIMEZONE:Europe/Amsterdam\r\n${body}\r\nEND:VCALENDAR\r\n`;

const timed = wrap(`BEGIN:VEVENT
DTSTART:20261116T160000Z
DTEND:20261116T180000Z
UID:timed-1
SUMMARY:Potluck
LOCATION:Eindhoven
DESCRIPTION:Bring food
END:VEVENT`.replaceAll('\n', '\r\n'));

const allDay = wrap(`BEGIN:VEVENT
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261202
UID:allday-1
SUMMARY:Holiday
END:VEVENT`.replaceAll('\n', '\r\n'));

const series = wrap(`BEGIN:VEVENT
DTSTART;TZID=Europe/Amsterdam:20200823T150000
DTEND;TZID=Europe/Amsterdam:20200823T200000
RRULE:FREQ=DAILY;COUNT=4
UID:series-1
SUMMARY:Intro Market
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Amsterdam:20200826T150000
DTEND;TZID=Europe/Amsterdam:20200826T200000
RECURRENCE-ID;TZID=Europe/Amsterdam:20200826T150000
UID:series-1
SUMMARY:[CANCELED] Intro Market
END:VEVENT`.replaceAll('\n', '\r\n'));

test('eventId is deterministic, valid and source-specific', () => {
  const a = eventId('eindhoven', 'uid-1');
  assert.equal(a, eventId('eindhoven', 'uid-1'));
  assert.notEqual(a, eventId('nijmegen', 'uid-1'));
  assert.notEqual(a, eventId('eindhoven', 'uid-1', 'RECURRENCE-ID:20200826'));
  assert.match(a, /^[0-9a-v]{5,}$/);
});

test('timed UTC event gets prefixed title and source note', () => {
  const [e] = mapCalendar(timed, source);
  assert.equal(e.body.summary, '[VSA Nijmegen] Potluck');
  assert.equal(e.body.start?.dateTime, '2026-11-16T16:00:00Z');
  assert.equal(e.body.location, 'Eindhoven');
  assert.match(e.body.description ?? '', /Bring food\n\nSource: VSA Nijmegen/);
  assert.equal(e.body.extendedProperties?.private?.sourceKey, 'nijmegen');
  assert.equal(e.body.extendedProperties?.private?.sourceUid, 'timed-1');
});

test('all-day event uses date fields', () => {
  const [e] = mapCalendar(allDay, source);
  assert.deepEqual(e.body.start, { date: '2026-12-01' });
  assert.deepEqual(e.body.end, { date: '2026-12-02' });
});

test('recurring series keeps RRULE and TZID; override becomes standalone and is excluded', () => {
  const events = mapCalendar(series, source);
  assert.equal(events.length, 2);
  const master = events.find((e) => e.body.recurrence)!;
  const override = events.find((e) => !e.body.recurrence)!;
  assert.equal(master.body.start?.timeZone, 'Europe/Amsterdam');
  assert.equal(master.body.recurrence?.[0], 'RRULE:FREQ=DAILY;COUNT=4');
  assert.match(master.body.recurrence?.[1] ?? '', /^EXDATE;TZID=Europe\/Amsterdam:20200826T150000$/);
  assert.equal(override.body.summary, '[VSA Nijmegen] [CANCELED] Intro Market');
  assert.notEqual(master.id, override.id);
});

test('cancelled events are skipped', () => {
  const ics = wrap(`BEGIN:VEVENT
DTSTART:20261116T160000Z
UID:c1
STATUS:CANCELLED
SUMMARY:Gone
END:VEVENT`.replaceAll('\n', '\r\n'));
  assert.equal(mapCalendar(ics, source).length, 0);
});

test('diff creates, updates, deletes and skips unchanged', () => {
  const [a] = mapCalendar(timed, source);
  const [b] = mapCalendar(allDay, source);
  const hashA = a.body.extendedProperties!.private!.hash;

  let plan = diff([a, b], [{ id: a.id, hash: hashA }, { id: 'stale' }]);
  assert.deepEqual([plan.create.length, plan.update.length, plan.remove, plan.unchanged], [1, 0, ['stale'], 1]);

  plan = diff([a], [{ id: a.id, hash: 'old' }]);
  assert.equal(plan.update.length, 1);
});
