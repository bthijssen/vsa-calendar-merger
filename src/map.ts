import ICAL from 'ical.js';
import { createHash } from 'node:crypto';
import type { calendar_v3 } from '@googleapis/calendar';

export interface Source {
  key: string;
  name: string;
  icsUrl: string;
}

export type GoogleEvent = calendar_v3.Schema$Event;

export interface MappedEvent {
  id: string;
  body: GoogleEvent;
}

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** Google event IDs only allow a-v and 0-9 (base32hex), 5-1024 chars. */
export function eventId(sourceKey: string, uid: string, recurrenceId = ''): string {
  const digest = createHash('sha256').update(`${sourceKey}\n${uid}\n${recurrenceId}`).digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest.subarray(0, 20)) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

type TimeField = { date: string } | { dateTime: string; timeZone?: string };

function timeField(prop: ICAL.Property, defaultTz: string): TimeField {
  const t = prop.getFirstValue() as ICAL.Time;
  if (t.isDate) return { date: t.toString() };
  const tzParam = prop.getParameter('tzid');
  const tzid = Array.isArray(tzParam) ? tzParam[0] : tzParam;
  if (tzid) return { dateTime: t.toString(), timeZone: tzid };
  if (t.zone === ICAL.Timezone.utcTimezone) return { dateTime: t.toString() };
  return { dateTime: t.toString(), timeZone: defaultTz };
}

function toGoogleTime(field: TimeField, recurring: boolean): calendar_v3.Schema$EventDateTime {
  if ('date' in field) return { date: field.date };
  // Google requires an explicit time zone on recurring events.
  if (!field.timeZone && recurring) return { dateTime: field.dateTime, timeZone: 'UTC' };
  return field.timeZone ? { dateTime: field.dateTime, timeZone: field.timeZone } : { dateTime: field.dateTime };
}

function endField(vevent: ICAL.Component, start: ICAL.Property, startField: TimeField, defaultTz: string): TimeField {
  const dtend = vevent.getFirstProperty('dtend');
  if (dtend) return timeField(dtend, defaultTz);

  const startTime = (start.getFirstValue() as ICAL.Time).clone();
  const duration = vevent.getFirstPropertyValue('duration') as ICAL.Duration | null;
  if (duration) startTime.addDuration(duration);
  else if (startTime.isDate) startTime.adjust(1, 0, 0, 0);
  else return startField;

  if (startTime.isDate) return { date: startTime.toString() };
  return 'timeZone' in startField && startField.timeZone
    ? { dateTime: startTime.toString(), timeZone: startField.timeZone }
    : { dateTime: startTime.toString() };
}

function str(vevent: ICAL.Component, name: string): string | undefined {
  const v = vevent.getFirstPropertyValue(name);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function recurrenceLines(vevent: ICAL.Component, extraExdates: string[]): string[] {
  const lines: string[] = [];
  for (const name of ['rrule', 'rdate', 'exdate']) {
    for (const prop of vevent.getAllProperties(name)) lines.push(prop.toICALString());
  }
  return [...lines, ...extraExdates];
}

function map(
  vevent: ICAL.Component,
  source: Source,
  defaultTz: string,
  recurrenceId: string,
  extraExdates: string[],
): MappedEvent | null {
  const uid = str(vevent, 'uid');
  const start = vevent.getFirstProperty('dtstart');
  if (!uid || !start) return null;
  if (str(vevent, 'status')?.toUpperCase() === 'CANCELLED') return null;

  const recurrence = recurrenceLines(vevent, extraExdates);
  const recurring = recurrence.length > 0 && !recurrenceId;
  const startF = timeField(start, defaultTz);
  const endF = endField(vevent, start, startF, defaultTz);

  const description = [str(vevent, 'description'), `Source: ${source.name}`].filter(Boolean).join('\n\n');
  const body: GoogleEvent = {
    summary: `[${source.name}] ${str(vevent, 'summary') ?? '(no title)'}`,
    description,
    location: str(vevent, 'location'),
    start: toGoogleTime(startF, recurring),
    end: toGoogleTime(endF, recurring),
    transparency: str(vevent, 'transp')?.toUpperCase() === 'TRANSPARENT' ? 'transparent' : 'opaque',
    status: 'confirmed',
  };
  if (recurring) body.recurrence = recurrence;

  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
  body.extendedProperties = { private: { sourceKey: source.key, sourceUid: uid, hash } };

  const id = eventId(source.key, uid, recurrenceId);
  body.id = id;
  return { id, body };
}

/**
 * Convert an iCalendar feed into Google Calendar events.
 * Recurrence overrides (RECURRENCE-ID) become standalone events and the
 * replaced instance is excluded from the master series with an EXDATE.
 */
export function mapCalendar(icsText: string, source: Source): MappedEvent[] {
  const root = new ICAL.Component(ICAL.parse(icsText));
  const defaultTz = (root.getFirstPropertyValue('x-wr-timezone') as string | null) ?? 'UTC';
  const vevents = root.getAllSubcomponents('vevent');

  const exdatesByUid = new Map<string, string[]>();
  for (const v of vevents) {
    const rid = v.getFirstProperty('recurrence-id');
    const uid = str(v, 'uid');
    if (!rid || !uid) continue;
    const line = rid.toICALString().replace(/^RECURRENCE-ID/i, 'EXDATE');
    exdatesByUid.set(uid, [...(exdatesByUid.get(uid) ?? []), line]);
  }

  const events = new Map<string, MappedEvent>();
  for (const v of vevents) {
    const uid = str(v, 'uid') ?? '';
    const rid = v.getFirstProperty('recurrence-id');
    const mapped = map(v, source, defaultTz, rid ? rid.toICALString() : '', rid ? [] : (exdatesByUid.get(uid) ?? []));
    if (mapped) events.set(mapped.id, mapped);
  }
  return [...events.values()];
}
