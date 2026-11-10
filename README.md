# VSA calendar combiner

Combines public iCal feeds (VSA Eindhoven, VSA Nijmegen, ...) into one Google Calendar owned by the organisation. A GitHub Actions job runs every 30 minutes and keeps the target calendar in sync.

- Every event title gets the source name as prefix, e.g. `[VSA Nijmegen] Introduction Market`.
- Events are matched by a deterministic ID (source key + iCal UID), so runs are idempotent. Only events created by this tool are ever updated or deleted.
- If a feed fails to download or parse, that source is skipped and its events are left alone.
- Recurring events (RRULE/EXDATE/TZID) are preserved. A modified instance of a series (RECURRENCE-ID) becomes a standalone event and is excluded from the series.
- Edits made to synced events in the target calendar are overwritten on the next sync. Edit the source calendar instead.

## Adding a calendar

Add an entry to [calendars.json](calendars.json):

```json
{ "key": "groningen", "name": "VSA Groningen", "icsUrl": "https://.../basic.ics" }
```

`key` must be unique and stable (lowercase letters, digits, `-`, `_`). Changing it later makes all of that source's events be recreated. `name` is used as the title prefix.

## One-time Google setup (needs a Workspace admin for some steps)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Create a **service account** (no project roles needed) and create a **JSON key** for it. If key creation is blocked, a Workspace/Cloud admin must allow it (organisation policy `iam.disableServiceAccountKeyCreation`).
3. In Google Calendar, create the target calendar (preferably from a shared organisational account).
4. In that calendar's settings, under **Share with specific people**, add the service account email with permission **Make changes to events**.
5. To let members subscribe, share the calendar publicly or within the domain. Making it public may require an admin to allow external sharing of calendars.
6. Copy the **Calendar ID** from the calendar's *Integrate calendar* section.
7. In the GitHub repository, add Actions secrets:
   - `TARGET_CALENDAR_ID`: the calendar ID
   - `GOOGLE_CREDENTIALS_JSON`: the full contents of the service account JSON key

Never commit the key file. `.gitignore` already excludes common key filenames.

## Usage

```powershell
npm ci
npm test
npm run sync:dry          # offline: downloads feeds and validates the mapping
$env:TARGET_CALENDAR_ID = '<calendar id>'
$env:GOOGLE_CREDENTIALS_JSON = Get-Content key.json -Raw
npm run sync:dry          # compares with the target calendar, writes nothing
npm run sync              # applies changes
```

Test against a throwaway calendar first before pointing at the real one.

The workflow in [.github/workflows/sync.yml](.github/workflows/sync.yml) runs every 30 minutes and can be started manually (with an optional dry-run). On a private repository the free plan includes 2,000 Actions minutes per month. A 30-minute schedule is about 1,440 runs, so keep runs short (about 1 minute) or reduce the frequency if minutes run out.

## Notes

- Google sometimes returns 403/429 rate-limit errors during the first large import (about 630 events). Writes are throttled and retried with backoff.
- Subscribers of the target calendar see updates as soon as a sync has run.
