# Changelog

All notable changes to this widget. Releases follow the repo's `refs/tags/vN`
tags; commit messages use conventional prefixes (`fix:`, `feat:`, `refactor:`,
`style:`, `docs:`).

## v6 — 2026-10-11

- `refactor`: dropped the on-device `diagnostics.txt` log entirely. Tap-routing
  and transaction-fetch diagnostics are no longer appended, so the per-period
  cache (`lunchMoneyCache` / `lunchMoneyCache_previous`) is now the only file the
  widget writes to Scriptable's Documents dir; unlike the old append-only log,
  the cache is overwritten each run and never grows unbounded. one `LEFTOVER_LABEL`
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