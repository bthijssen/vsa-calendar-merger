import { calendar, auth, type calendar_v3 } from '@googleapis/calendar';
import type { MappedEvent } from './map.ts';

export interface Plan {
  create: MappedEvent[];
  update: MappedEvent[];
  remove: string[];
  unchanged: number;
}

export interface ExistingEvent {
  id: string;
  hash?: string;
}

export function diff(desired: MappedEvent[], existing: ExistingEvent[]): Plan {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const desiredIds = new Set(desired.map((d) => d.id));
  const plan: Plan = { create: [], update: [], remove: [], unchanged: 0 };

  for (const d of desired) {
    const current = existingById.get(d.id);
    if (!current) plan.create.push(d);
    else if (current.hash !== d.body.extendedProperties?.private?.hash) plan.update.push(d);
    else plan.unchanged++;
  }
  for (const e of existing) if (!desiredIds.has(e.id)) plan.remove.push(e.id);
  return plan;
}

export function createClient(): calendar_v3.Calendar {
  const json = process.env.GOOGLE_CREDENTIALS_JSON;
  const googleAuth = new auth.GoogleAuth({
    ...(json ? { credentials: JSON.parse(json) } : {}),
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  });
  return calendar({ version: 'v3', auth: googleAuth });
}

function status(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const code = e.response?.status ?? e.status ?? e.code;
  return typeof code === 'number' ? code : Number(code) || undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const s = status(err);
      const retryable = s === 403 || s === 429 || (s !== undefined && s >= 500);
      if (!retryable || attempt >= 6) throw err;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500);
    }
  }
}

export async function listOwned(cal: calendar_v3.Calendar, calendarId: string, sourceKey: string): Promise<ExistingEvent[]> {
  const out: ExistingEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      cal.events.list({
        calendarId,
        privateExtendedProperty: [`sourceKey=${sourceKey}`],
        showDeleted: false,
        singleEvents: false,
        maxResults: 2500,
        pageToken,
      }),
    );
    for (const e of res.data.items ?? []) {
      if (e.id) out.push({ id: e.id, hash: e.extendedProperties?.private?.hash });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export async function apply(cal: calendar_v3.Calendar, calendarId: string, plan: Plan): Promise<void> {
  const pace = () => sleep(150);

  for (const e of plan.create) {
    try {
      await withRetry(() => cal.events.insert({ calendarId, requestBody: e.body }));
    } catch (err) {
      // 409: ID exists as a deleted event from an earlier run; revive it.
      if (status(err) !== 409) throw err;
      await withRetry(() => cal.events.update({ calendarId, eventId: e.id, requestBody: e.body }));
    }
    await pace();
  }
  for (const e of plan.update) {
    await withRetry(() => cal.events.update({ calendarId, eventId: e.id, requestBody: e.body }));
    await pace();
  }
  for (const id of plan.remove) {
    try {
      await withRetry(() => cal.events.delete({ calendarId, eventId: id }));
    } catch (err) {
      if (status(err) !== 404 && status(err) !== 410) throw err;
    }
    await pace();
  }
}
