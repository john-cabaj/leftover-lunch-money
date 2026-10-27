---
name: update-check
description: Use when working with the widget's update notice in index.js — fetchUpdateInfo, hasUpdate, copyUpdateToClipboard, SCRIPT_VERSION, UPDATE_CHECK_KEY, UPDATE_CHECK_MS, tagVersion, newestTag, isNewerVersion, the ?update= deep link, or the "Update Available!" badge line. Also use when cutting a release (the pushed git tag is the only thing the widget can see) or when the notice misbehaves.
---

# Update Check

How the widget learns that a newer version exists, and what a release must do for that to work. The widget has no updater of its own: it only surfaces a release and hands the user a paste-in upgrade.

## The source of truth is the repo's git TAGS

The check reads `https://api.github.com/repos/<UPDATE_REPO>/tags?per_page=100` (unauthenticated, with a `User-Agent` header) and picks the highest-numbered `vN` tag.

- This project ships each version as a git tag (`refs/tags/vN`) and publishes **no GitHub Release objects at all**. `/releases/latest` returns 404, so a release-based check never fires; `/releases/tag/<tag>` 404s too, which is why the fallback page is the tag's tree (`github.com/<repo>/tree/<tag>`), not a release page.
- The API's list order is not a version order — `newestTag` picks the highest NUMBER (`tagVersion`), never the first entry.
- A tag that is not `v<digits>` is ignored (`tagVersion` returns -1), so stray tags like `nightly` never win.
- The check is unauthenticated, so GitHub's 60-requests/hour-per-IP limit applies. The widget's own throttle is one request per day, but a shared IP can still 429; a failed check fails silent and reuses the cached record.

## The version rule

`isNewerVersion(tag, current)` requires the tag to be **strictly** greater than the running version. `SCRIPT_VERSION` must equal the release tag of the script that is running.

The rule is applied in two places on purpose:

- `fetchUpdateInfo` — before the tag is written into the check record (an older or equal tag is stored as an empty tag: "no newer release").
- `hasUpdate` — when the record is used. The record lives on disk for a day, so a record written before the user upgraded would otherwise keep nagging about a version they already have.

A build ahead of the latest tag (a local `v13` script while the newest published tag is `v12`) shows no notice, and neither does an equal version.

## The daily throttle and the on-disk record

- `UPDATE_CHECK_MS` = 24 hours. `fetchUpdateInfo` returns the cached record while it is fresh and only hits the network past that.
- The record lives in its own file (`UPDATE_CHECK_KEY` = `lunchMoneyUpdateCheck`) in the widget folder, outside the per-period cache files, so a period run's cache never clobbers it. `sweepWidgetStorage` keeps it (and the two cache files) and deletes everything else in that folder.
- The record is `{ tag, checkedAt }`. A failed fetch returns the cached record (even a stale one) or `null`; it never throws — an update check must never block the widget's render.
- `getAllData` bakes the tag into the period cache as `data.updateTag`, and only on the fetch path — a cache reuse skips the check, so the notice can lag by the cache's own freshness (`CACHED_MS`, 10 minutes) on top of the record's age.

## The notice

`hasUpdate` drives the shared top-of-list line, which shows **"Update Available!"** (`BADGE_UPDATE_LABEL`, `UPDATE_GREEN`) — but only when nothing is awaiting a manual delete: pending deletes win the single line. On the small stacked widget the line is display-only, because a small widget has a single tap target (Budget, via `widget.url`) and per-element urls never fire there.

## The update tap

`updateTapUrl` builds `scriptable:///run?scriptName=<name>&update=<tag>` — the tag rides `?update=`, **not** `?url=`, so `tappedTarget()` does not treat it as a web page. `resolveTap()` checks the update tag before the page and fallback branches and returns `{ kind: 'update', tag }`.

The SETUP tap branch then runs `copyUpdateToClipboard(tag)`:

1. fetch `raw.githubusercontent.com/<repo>/refs/tags/<tag>/index.js`,
2. `Pasteboard.copyString` it,
3. show an Alert whose "Open Editor" action `Safari.open`s `scriptable:///open?scriptName=<name>` — the user stays IN Scriptable and pastes over the old script.

Unlike a page tap, an update tap does **not** call `App.close()`. If the download fails, it falls back to opening the tag's page (`github.com/<repo>/tree/<tag>`).

## Release checklist (what makes the notice reach users)

- Bump `SCRIPT_VERSION` to the new tag in the same release.
- Add the `## vN — YYYY-MM-DD` CHANGELOG entry (the pre-commit hook enforces it for every tag).
- **Push the tag.** A local tag is invisible to the widget — the check reads GitHub's tag list, so until the tag is pushed, nobody gets the notice. The repo's rule is never to push, so this handoff is explicit.
- Do not create GitHub Release objects: the check ignores them, and their `/releases/tag/` pages 404.
- Keep the README install link on the pushed tag (`.../refs/tags/vN/index.js`).

## Verification

- `node --test test/*.test.js` pins `tagVersion`, `newestTag`, `isNewerVersion`, and the `updateTapUrl` golden.
- A live probe of the tags API confirms the newest published tag and that the version comparison behaves for the installed version.
- The raw tag URL must serve the script (`raw.githubusercontent.com/<repo>/refs/tags/<tag>/index.js` → 200), and the tag's tree page must exist — that is the fallback the update tap opens.
- End-to-end: the update tap copies the script to the clipboard and opens the editor; a failed download opens the tag page instead.
