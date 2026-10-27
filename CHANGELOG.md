# Changelog

All notable changes to this widget. Releases follow the repo's `refs/tags/vN`
tags; commit messages use conventional prefixes (`fix:`, `feat:`, `refactor:`,
`style:`, `docs:`).

## v14 — 2026-10-27

- `docs`: the domain rules now live in tool-neutral `.agents/skills/` and are
  indexed from `AGENTS.md`; the release tooling (`tools/release-scope.mjs`,
  the pre-commit hook, and the repo-consistency test) was updated to match.
  There are no widget behavior changes since v13.
- `docs`: `SCRIPT_VERSION` bumped to v14; README install links point at the v14
  tag.

## v13 — 2026-10-21

- `fix`: the update check now reads the repo's git TAGS instead of the GitHub
  releases API. This project ships each version as a `refs/tags/vN` tag and
  publishes no Release objects, so `/releases/latest` returned 404 on every
  check: the "Update Available!" line never appeared, and the failed check was
  retried (never throttled) on every run. The check reads `/tags` instead, picks
  the highest-numbered `vN` tag rather than the first entry, and only offers a
  tag that is strictly newer than `SCRIPT_VERSION` (`tagVersion`, `newestTag`,
  `isNewerVersion`).
- `fix`: the notice is raised only for a release newer than the running script.
  The check record (and the tag it carries) is cached on disk for a day, so a
  record written before an upgrade could otherwise nag about a version the user
  already has; `hasUpdate` now compares the cached tag against `SCRIPT_VERSION`.
- `fix`: when the new script can't be downloaded, the update tap opens the
  tag's own page (`…/tree/vN`) instead of the Release page (`…/releases/tag/vN`),
  which does not exist for this repo.
- `refactor`: the shared top-of-list line is named for what it carries
  (`addBadgeLine`, `badgeLineHeight`, `BADGE_RESERVE_LAYOUTS`), the
  single-target layouts are one named constant (`BUDGET_ONLY_LAYOUTS`), and
  `MAX_SIGNED_MONEY` derives from the money formatter instead of repeating a
  literal.
- `docs`: `SCRIPT_VERSION` bumped to v13; README install links point at the v13
  tag.

## v12 — 2026-10-20

- `fix`: the medium review list's Menlo transaction rows now take the
  `MENLO_LEFT_INSET` leading nudge, so they share the "Unreviewed
  Transactions" caption's (and the top-of-list badge's) visual left edge.
  Avenir and Menlo render their first glyph at slightly different left
  bearings, which made the caption read ~1pt indented against the rows below
  it; the nudge previously reached only the lock-screen rectangular
  accessory. `menloInsetLayout` names the layouts that get it (medium review
  + rectangular accessory), and `payeeMax` subtracts the same points so the
  payee width budget stays honest.
- `docs`: `SCRIPT_VERSION` bumped to v12; README install links point at the
  v12 tag.

## v11 — 2026-10-19

- `feat`: the widget now notices new releases. Once a day it checks the latest
  GitHub release (`fetchUpdateInfo`, cached on disk for `UPDATE_CHECK_MS` and
  failing silent) and, when it is newer than `SCRIPT_VERSION`, reuses the
  shared top-of-list badge line to show a green "Update Available!"
  (`BADGE_UPDATE_LABEL`, `UPDATE_GREEN`). Pending deletes always win the single
  line, so the update notice only appears when nothing is awaiting a manual
  delete. Tapping it (a `scriptable:///run?scriptName=…&update=<tag>` deep link,
  a distinct `?update=` param — not `?url=`) fetches that tag's `index.js`,
  copies it to the clipboard, and opens the script in the editor for a
  paste-in update (`copyUpdateToClipboard`), leaving the user in Scriptable;
  it never overwrites the script itself.
- `refactor`: the badge line's trigger and height are now shared
  (`hasBadgeLine`, unchanged `deletePendingBadgeHeight`) so the pending and
  update messages reserve the same list space, and `sweepWidgetStorage` keeps
  the update-check record alongside the period caches.

## v10 — 2026-10-19

- `feat`: the displayed period's start/end now come from the API's own budget
  boundaries instead of only the locally walked anchor. `/summary` is requested
  with `include_occurrences` + `include_past_budget_dates`; `reconcilePeriodRange`
  adopts the occurrence overlapping the locally computed seed — correcting a
  wrong anchor or a granularity the local walk doesn't model (e.g. "twice a
  month") — and when the seed misses, refetches `/summary` pinned to the real
  period and repulls the unreviewed rows for that range. Aligned periods (the
  norm) keep the existing single-call path.
- `refactor`: the delete-pending count is no longer capped at 100. That pull
  now sends no `limit` (using the API's default page size, raised to 1000 in
  v2.8.3) like the unreviewed pull; the badge only tests the count for nonzero,
  so the old cap bought nothing but a possible undercount.
- `refactor`: dropped the dead per-category `rollover_pool` read and its
  `available` fallback in `shapeBudgetRow` — the API removed category-level
  `rollover_pool` (v2.11.0), and an aligned `/summary` always supplies
  `available`, so the fallback never fired. `/summary` query params are now
  built once in `summaryParams`.

## v9 — 2026-10-17

- `feat`: full-month transactions taps keep the web app's quick search bar. The
  web app hides that bar whenever the URL carries a `time=custom` range (any
  `status`/`match` filter hides it too), and it ignores `start_date`/`end_date`
  without `time=custom` — so pinning every period with a range cost the plain
  widget tap its search box. `periodIsFullMonth` now detects a period that IS
  its whole calendar month (1st → last day) and drops the range, letting the
  `/transactions/YYYY/MM` path pin the period exactly; custom periods keep
  their exact range, and the unreviewed / Delete Pending targets keep their
  filters (no URL shape shows the bar AND applies a custom range or filter).
- `refactor`: the last-day-of-month idiom (`new Date(y, m + 1, 0)`) is now one
  `lastDayOfMonth(year, month)` helper, shared by `addMonthsClamped`,
  `getBudgetPeriodForDate`, `getCalendarMonthRange`, and `periodIsFullMonth`;
  the unreviewed tap URL is likewise built once and shared by the caption row
  and the list stack instead of being recomputed per target.

## v8 — 2026-10-14

- `feat`: the Delete Pending badge is now period-independent. Manual deletes
  are account-wide, so the widget counts `delete_pending` transactions across
  the whole history (capped at `DELETE_PENDING_LIMIT`, 100) instead of only the
  displayed period; the badge shows whenever any exist, matching its tap
  target, which already opened the unfiltered `status=delete pending&time=all`
  list.
- `refactor`: the title + period header height is now measured through one
  `headerBlockHeight(config, measure)` (the full Avenir box by default, the lean
  box in the review list budget) instead of duplicating the formula.

## v7 — 2026-10-12

- `fix`: a failed `/transactions` pull no longer wipes the unreviewed list or
  the Delete Pending badge. A successful `/summary` + `/categories` fetch used
  to cache an empty, "failed" result over the last good list and poison the
  cache for its whole 10-minute window; the widget now carries the previous
  record's rows/count forward with their original fetch time, renders a
  carried-forward list dimmed so it doesn't read as fresh, and only shows
  "Couldn't load unreviewed" when there is nothing to fall back on. New
  per-field `unreviewedUpdatedAt` / `deletePendingUpdatedAt` timestamps track
  each list's true age; records predating the per-field stamp fall back to the
  record's own `lastUpdated`.

## v6 — 2026-10-11

- `feat`: the boot path now sweeps Scriptable's widget folder on every run
  (`sweepWidgetStorage`), deleting every file that isn't one of the two period
  caches. Files a prior version stopped using — most notably the dropped
  `diagnostics.txt` — and any other stray/unknown file can no longer linger on
  device, while both caches (`lunchMoneyCache` / `lunchMoneyCache_previous`) are
  always kept, so caching is unaffected. The sweep runs only on the boot path,
  never on a tap.
- `refactor`: dropped the on-device `diagnostics.txt` log entirely. Tap-routing
  and transaction-fetch diagnostics are no longer appended, so the per-period
  cache (`lunchMoneyCache` / `lunchMoneyCache_previous`) is now the only file the
  widget writes to Scriptable's Documents dir; unlike the old append-only log,
  the cache is overwritten each run and never grows unbounded. One `LEFTOVER_LABEL`
  constant now feeds the METRICS row and every leftover caption
  (error state, breakdown, accessories), and `deletePendingBadgeHeight` reuses
  `hasDeletePending` instead of re-deriving the same predicate; stale
  history-flavored comments were reworded to state intent.

## v5 — 2026-10-11

- `fix`: the widget now asks WidgetKit to reload its timeline via
  `widget.refreshAfterDate` (now + `CACHED_MS`) instead of deferring entirely to
  iOS's background-refresh schedule, so the "last updated" time no longer
  stalls for hours; the refresh hint is aligned with the 10-minute cache window.
- `fix`: `sendLunchMoneyRequest` rejects on a non-2xx status. The API's JSON
  error bodies (e.g. a 401 `{"message":"Unauthorized"}` from a bad/expired key)
  were parsed as data and cached with a fresh `lastUpdated`; they now fall
  through to the last good stale cache.
- `fix`: a malformed 2xx body is treated as a failed fetch too — a `/summary`
  or `/categories` response without a categories array no longer caches an
  empty leftover, and a `/transactions` response without a transactions array
  reports "failed" instead of an empty list. The API's `{message, errors}`
  error envelope is also rejected, so a bad key fails safely even if
  `request.response` is unavailable.
- `fix`: a widget render no longer tries to present the API-key prompt (a
  widget can't show an alert); it renders the "add your key" state instead. A
  failed cache write is now best-effort, so freshly fetched data still renders.
- `fix`: `sendLunchMoneyRequest` caps every API call at a 10-second timeout
  (`REQUEST_TIMEOUT`) instead of Scriptable's 60-second default, so an
  unresponsive API fails fast and falls through to the stale cache rather than
  the widget being killed with "Timeout while running script".

## v4 — 2026-10-06

- `docs`: moved AGENTS.md's domain rules into on-demand opencode skills and
  slimmed it down (~76% token reduction); existing rules now load via the
  `leftover-math`, `widget-layout`, `tap-navigation`, `budget-periods`, and
  `finalize-release` skills.
- `refactor`: add a deterministic node:test suite (`test/pure-core.test.js`)
  that extracts the pure logic from `index.js` by marker and evaluates it in
  plain Node (no Scriptable runtime needed); it also re-runs the layout/fit
  math headlessly per known iPhone screen (stubbed `Device.screenSize()` /
  `Font` with no `.lineHeight`, so the shipped fallback factors apply) and pins
  the device tables, per-family row pitches, Delete Pending badge reserves,
  the small-amount font, and the "rows never overflow the budget" invariant.
- `fix`: `addMonthsClamped` rolled Jan 31 → Mar 29 when shifting a month; it
  now clamps to Feb 28/29 as documented (caught by the new suite).
- `refactor`: `index.js` gains a SECTION INDEX banner.
- `docs`: add CHANGELOG; pre-commit (`node --check` + tests) and commit-msg
  (conventional prefix) git hooks in `.githooks/` installed to `.git/hooks/`.

## v3 — 2026-09-23

- `feat`: add Delete Pending label linking to `delete_pending` transactions
  (all of them, unfiltered by date), topping the unreviewed column on
  home-screen widgets and the metrics on the small stacked widget.

## v2 — 2026-09-19

- `feat`: add scaled layouts for lock-screen accessory widgets.
- `fix`: take the larger of expected and actual income as inflow (per-category
  max of budget vs realized; over-performing income categories no longer get
  masked down to their budget).

## v1 — 2026-09-13

- `fix`: limit the unreviewed tap target to the label and list rows instead of
  the whole column.
- Initial release.