# VSA Calendar Merger

Combines public iCal feeds into one Google Calendar owned by the organisation. A GitHub Actions job runs every 30 minutes and keeps the target calendar in sync.

Current sources (any public `.ics` feed works, including Google Calendar and Luma):

| Source | Key | Feed type |
|---|---|---|
| VSA Eindhoven | `eindhoven` | Google Calendar |
| VSA Nijmegen | `nijmegen` | Google Calendar |
| VSA Amsterdam | `amsterdam` | Luma |

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

## Usage on GitHub

The sync runs entirely in GitHub Actions. You don't need to run anything on your own computer.

**Automatic:** the workflow in [.github/workflows/sync.yml](.github/workflows/sync.yml) runs every 30 minutes on the default branch.

**Manual run:**

1. Open the repository on GitHub and go to the **Actions** tab.
2. In the left list, select **Sync calendars**.
3. Click **Run workflow**.
4. Optional: tick **Plan changes without writing** to do a dry run. The log then shows what would be created, updated or deleted, without changing the calendar.
5. Click **Run workflow** again to start it.

**Checking a run:** open the run in the Actions tab and expand the **Sync** step. Lines look like `[nijmegen] create=409 update=0 delete=0 unchanged=0`. A line ending in `failed:` means that source was skipped. The run then ends with a failure status.

**Pausing:** in the Actions tab, open **Sync calendars**, click **⋯**, then **Disable workflow**. Re-enable it the same way.

**Free minutes:** a private repository gets 2,000 Actions minutes per month. A 30-minute schedule is about 1,440 runs. Keep each run short, or switch to an hourly schedule if minutes run out. Usage is under **Settings → Billing and plans → Usage**.

## Local development

Only needed when changing the code.

```powershell
npm ci
npm test
npm run sync:dry    # offline: downloads feeds and validates the mapping
```

## Notes

- Google sometimes returns 403/429 rate-limit errors during the first large import (about 630 events). Writes are throttled and retried with backoff.
- Subscribers of the target calendar see updates as soon as a sync has run.
