## Project Overview

An iOS widget built with [Scriptable](https://scriptable.app) that shows a reflection of the leftover money from [LunchMoney](https://my.lunchmoney.app) for a given period, along with a list of unreviewed transactions for that same period. "Leftover" is the amount remaining after income and spending for the period.

## Agent Skills

Domain rules live in on-demand skills under `.agents/skills/<name>/SKILL.md` (the open Agent Skills format). Tools that support the standard load them automatically; otherwise read the file before touching the matching code.

| Skill | Read before touching |
|---|---|
| `budget-periods` | period/date resolution |
| `data-layer` | API requests, cache, side-lists |
| `leftover-math` | `computeLeftover` and inflow/outflow rules |
| `tap-navigation` | tap and deep-link routing |
| `update-check` | the new-release notice |
| `widget-layout` | layout, sizing, row-fit math |
| `testing` | `test/pure-core.test.js` |
| `finalize-release` | only when asked to cut a release |

## Architecture

- Single-file widget: `index.js` — no build process or dependencies; a pure-logic test suite lives in `test/` (see Development Notes)
- Runs as a home-screen widget via the Scriptable app on iPhone/iPad
- Pulls period totals, category data, and unreviewed transactions from the Lunch Money API, then computes the period leftover
- API key is stored in the iOS Keychain (not in the widget code); the Scriptable setup prompt asks the user to paste their own key
- Cache lives under Scriptable's local Documents dir (`LunchMoneyWidget/`), keyed per period:
  - `lunchMoneyCache` — current period
  - `lunchMoneyCache_previous` — previous period
- The boot path runs `sweepWidgetStorage()`, a best-effort janitor that deletes every file in `LunchMoneyWidget/` except the two cache files — so retired files (the dropped `diagnostics.txt`) and other stray/unknown files can't linger on device
- Cache freshness is 10 minutes (`CACHED_MS`); if a fetch fails and the cache has expired, the stale copy is used as a fallback
- The widget asks WidgetKit to reload at `widget.refreshAfterDate` (now + `CACHED_MS`) so a run lands near expiry instead of waiting on iOS's own schedule
- A non-2xx (or malformed) API response is treated as a failed fetch, so the stale copy is used instead of caching an empty/error result; a widget render never opens the API-key prompt (it shows the setup state)

## Widget Parameters

The Scriptable widget parameter selects the budget period to display. Matching is case-insensitive and whitespace-trimmed:

- `previous` — shows the budget period before the current one
- `current` (or empty/no value) — shows the current budget period (default)

The cache is split per period so a "previous" request never serves the current period's data (or vice versa).

## Budget Periods

Period resolution rules — `/budgets/settings` (anchor, quantity, granularity, use-last-day-of-month), the calendar-month fallback, `previous` derivation, and unreviewed-transaction filtering — live in the `budget-periods` skill; load it before touching `addBudgetPeriod`, `getPeriodRange`, `periodLabelFor`, or any period/date code.

## Leftover Calculation

Budget-based, not spend-based: `leftover = inflow − outflow`. The authoritative calculation rules (per-category inflow, outflow contributions, uncategorized buckets, group mutual exclusion) live in the `leftover-math` skill — load it before touching `computeLeftover`, `incomeInflow`, or any inflow/outflow code.

## Data Layer and Cache

Request, cache, and storage rules — a non-2xx or malformed response is a *failed* fetch (never cached as data), the stale-copy fallback, the side-list carry-forward (a failed pull keeps the previous value and its original timestamp), the per-period cache files, and the storage sweep — live in the `data-layer` skill; load it before touching `sendLunchMoneyRequest`, `lunchMoneyLeftoverInfo`, `getAllData`, `readCache`, `writeCache`, `sweepWidgetStorage`, `carryForwardSideList`, or the Mock API's behavior.

## Tap Navigation

Tap routing rules — `resolveTap()`, `tappedTarget()`, `presentWebPage()`, the per-region targets, and the lock-screen accessory fallback — live in the `tap-navigation` skill; load it before touching `appDeepLink`, `resolveTap`, `cameFromTap`, `fallbackTapUrl`, `transactionPageUrl`, `budgetTapUrl`, `deletePendingTapUrl`, or `widget.url`. Two invariants hold no matter what:

- Taps never leave Scriptable: a tap's only job is to show one page, after which the script ends; only a presented tap page calls `App.close()`, and only after the user dismisses it. The boot path (API key, widget render, `setWidget`) runs only for non-tap runs.
- A small widget opens whatever `widget.url` holds no matter where it is tapped (Scriptable only honors element urls in medium and large widgets), so the small stacked widget's single tap target is Budget.

## Update Check

Update-notice rules — the widget learns about new releases from the repo's git TAGS (this project publishes no GitHub Release objects), the once-a-day throttle and its on-disk record, the version comparison, the `?update=` deep link, and the download-and-copy path — live in the `update-check` skill; load it before touching `fetchUpdateInfo`, `hasUpdate`, `copyUpdateToClipboard`, `SCRIPT_VERSION`, `UPDATE_CHECK_KEY`, `newestTag`, or `isNewerVersion`. Two rules hold no matter what:

- `SCRIPT_VERSION` must equal the release tag of the running script; a tag that is not strictly newer than it never raises a notice
- The pushed tag is the only thing the widget can see — a local tag reaches nobody until it is pushed (the repo never pushes; that handoff is explicit)

## Layout Conventions

Layout and sizing rules — `FAMILY_LAYOUTS`, padding/gaps, title centering, Delete Pending badge rendering, row-fit math, and calibration knobs — live in the `widget-layout` skill; load it before touching `renderWidget`, `addTextRow`, `rowFitHeight`, `widgetSizes`, `listHeightBudget`, or any family/size constant. These three invariants hold no matter what:

- Layout gaps are named constants (`REVIEW_GAP`, `OVERVIEW_GAP`, `LIST_BODY_GAP`) used in BOTH the renderers and `listHeightBudget` — always update both sites together
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow
- `FAMILY_LAYOUTS` uses one `amount` size for all three money rows; don't reintroduce per-metric-size duplication

## Security Rules

- Never ask a user for their API key at any point in the process. Users should paste their own API key into the Scriptable app directly.
- Never access a user API key at any point in the process. If access to API data is needed, it should always go through the Mock API - https://mock.lunchmoney.dev/v2.

## Development Notes

- Verify with `node --check index.js` and the pure-logic test suite `node --test test/*.test.js` (run both together before committing; the pre-commit hook does this automatically). There is no linter.
- The widget file cannot be required directly because it evaluates Scriptable globals (e.g. `new Font`) at load. `test/pure-core.test.js` extracts the pure functions from `index.js` by marker (`buildQueryString`, `indexCategories` … `sumBreakdownFields`, `formatMoney` … `periodLabelFor`, `periodPathParts` … `transactionsTapUrl`) and evaluates them in a VM context — keep those function signatures and their boundary comments intact. It also slices the widget-LAYOUT fit math and runs it headlessly per known iPhone; the fit-spec reference (regions, stubs, pinned matrices, recalibration workflow) lives in the `widget-layout` skill's Verification section. It contains a golden URL, period-math, leftover-invariant, and layout-fit spec; when you change pure logic or layout constants, extend the suite and run it.
- `index.js` opens with a SECTION INDEX banner; keep it in sync when regions move.
- The pure-logic suite's mechanics — the marker-based extraction, the VM sandbox, the golden values, and how to add a case — live in the `testing` skill; load it before changing `test/pure-core.test.js`. The suite covers pure logic only: the boot path (Scriptable globals, the API, the cache, rendering) needs a stub harness or an on-device run.
- Commit hooks live in `.githooks/` and are also installed in `.git/hooks/` (pre-commit: `node --check` + tests + a check that every release tag has a matching CHANGELOG.md entry; commit-msg: conventional prefixes). Re-copy them when re-cloning. A manually-created release tag without a changelog entry blocks the next commit until the entry is added.
- Mock API behavior (https://mock.lunchmoney.dev/v2): `/categories` is stable across calls, but `/summary` returns varying data on every request and requires `start_date`/`end_date` (400 otherwise). Verify with relative invariants, not fixed expected numbers — the leftover-specific invariants are in the `leftover-math` skill.

## Tools

`tools/` holds the runnable checks the skills refer to. They need no dependencies beyond Node and never touch a real user API key.

| Tool | What it does |
|---|---|
| `node tools/release-scope.mjs` | maps the changes since the last release tag to the areas (and skills) a finalize-release pass must cover; `--json` for machine output, `--tag vN` for a different boundary |
| `node tools/boot-harness.mjs` | boots the real `index.js` against Scriptable stubs: every widget family × current/previous × pending/clean renders, the tap branches, and the key-less setup state |
| `node tools/verify-mock.mjs` | runs the leftover math against the Mock API's relative invariants |
| `node tools/check-update.mjs` | the live update check: the newest published tag, the notice for each installed version, and whether that tag's raw URL exists |
| `node tools/check-release.mjs` | release hygiene: `SCRIPT_VERSION`, the README install link, the CHANGELOG entries, and whether the tag is on the remote (`--tag vN` checks a candidate release) |

- `tools/release-scope.areas.json` is the single source of truth for the area map — every top-level symbol in `index.js` and the area that owns it. `test/repo-consistency.test.js` guards it: a symbol that appears in or disappears from `index.js` without the map following fails the suite.
- The Mock API rate-limits bursts (~100 requests/minute), so the harness caches identical requests and retries a 429 with a backoff.

## Git Workflow

- Commit whenever you finish a piece of work, not only at a release finalization: after each completed, verified task (changes pass `node --check` + the test suite), run the commit for that step rather than batching work up and leaving it uncommitted. The `finalize-release` pass is one such step, not the only one. Concise conventional-prefix commits (`fix:`, `feat:`, `refactor:`, `style:`, `docs:`) are preferred over a single large one.
- Never push to a remote.

## Finalizing a Release

When the user asks to finalize, cut, or release a version (`vN`) — or names the `finalize-release` skill — you MUST run the full workflow before creating or moving any `vN` tag. This is not optional and must never be reduced to editing `CHANGELOG.md` and tagging.

- Load the `finalize-release` skill first (`.agents/skills/finalize-release/SKILL.md`). If your tool does not auto-load skills from `.agents/skills/`, read that file directly and follow it verbatim. Domain skills live alongside it.
- Complete all five steps (simplify, cross-check, comment cleanup, verify, changelog) plus "Establish the baseline". The pass is SCOPED to the areas changed since the last release tag — the skill's Step 0 derives that scope from the diff and names the areas; run `node tools/release-scope.mjs` to get that scope instead of eyeballing the diff. A release that changes one area reviews only that area, and only that area's domain skill is loaded. If the pass reaches into another area, load that area's skill then. Step 5 (the changelog) and the baseline stay global, because they describe the release as a whole.
- Only after the full pass: commit, then create/move the `vN` tag, and confirm `CHANGELOG.md` has the matching `## vN` entry (the pre-commit hook enforces the entry). `node tools/check-release.mjs --tag vN` checks the release's hygiene before the tag is created.