const MAX_CHARS = 10 * 1024 * 1024;

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length > MAX_CHARS) throw new Error(`Feed too large (${text.length} chars)`);
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Response is not an iCalendar feed');
  return text;
}
