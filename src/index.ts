import { readFile } from 'node:fs/promises';
import { fetchIcs } from './fetch.ts';
import { mapCalendar, type Source } from './map.ts';
import { apply, createClient, diff, listOwned } from './sync.ts';

const dryRun = process.argv.includes('--dry-run');
const calendarId = process.env.TARGET_CALENDAR_ID;

async function main(): Promise<void> {
  const sources: Source[] = JSON.parse(await readFile(new URL('../calendars.json', import.meta.url), 'utf8'));
  const keys = new Set<string>();
  for (const s of sources) {
    if (!/^[a-z0-9_-]+$/.test(s.key) || keys.has(s.key)) throw new Error(`Invalid or duplicate source key: ${s.key}`);
    keys.add(s.key);
  }

  // Without a target calendar, a dry run only validates the feeds and mapping.
  const offline = dryRun && !calendarId;
  if (!dryRun && !calendarId) throw new Error('TARGET_CALENDAR_ID is required');
  const cal = offline ? undefined : createClient();

  let failures = 0;
  for (const source of sources) {
    try {
      const events = mapCalendar(await fetchIcs(source.icsUrl), source);
      if (!cal || !calendarId) {
        console.log(`[${source.key}] ${events.length} events mapped (offline dry run)`);
        continue;
      }
      const plan = diff(events, await listOwned(cal, calendarId, source.key));
      console.log(
        `[${source.key}] create=${plan.create.length} update=${plan.update.length} delete=${plan.remove.length} unchanged=${plan.unchanged}${dryRun ? ' (dry run)' : ''}`,
      );
      if (!dryRun) await apply(cal, calendarId, plan);
    } catch (err) {
      // A failing source is skipped entirely so its existing events are never deleted.
      failures++;
      console.error(`[${source.key}] failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

await main();
