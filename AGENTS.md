## Project Overview

An iOS widget built with [Scriptable](https://scriptable.app) that shows a reflection of the leftover money from [LunchMoney](https://my.lunchmoney.app) for a given period, along with a list of unreviewed transactions for that same period. "Leftover" is the amount remaining after income and spending for the period.

## Architecture

- Single-file widget: `index.js` — no build process, dependencies, or tests
- Runs as a home-screen widget via the Scriptable app on iPhone/iPad
- Pulls period totals, category data, and unreviewed transactions from the Lunch Money API, then computes the period leftover
- API key is stored in the iOS Keychain (not in the widget code); the Scriptable setup prompt asks the user to paste their own key
- Cache and diagnostics live under Scriptable's local Documents dir (`LunchMoneyWidget/`), keyed per period:
  - `lunchMoneyCache` — current period
  - `lunchMoneyCache_previous` — previous period
- Cache freshness is 10 minutes (`CACHED_MS`); if a fetch fails and the cache has expired, the stale copy is used as a fallback

## Widget Parameters

The Scriptable widget parameter selects the budget period to display. Matching is case-insensitive and whitespace-trimmed:

- `previous` — shows the budget period before the current one
- `current` (or empty/no value) — shows the current budget period (default)

The cache is split per period so a "previous" request never serves the current period's data (or vice versa).

## Budget Periods

Periods come from Lunch Money's `/budgets/settings` (anchor date, granularity, quantity, and the "use last day of month" flag); when the account has no custom period, the calendar month is used instead. `previous` resolves the period containing the day before the current period's start. Unreviewed transactions are fetched for the same range, filtering client-side so both v1 ("uncleared") and v2 ("unreviewed") statuses are recognized.

## Leftover Calculation

`computeLeftover` is budget-based, not spend-based: `leftover = inflow − outflow`.

- `inflow` is the sum of the summary's `totals.inflow` breakdown fields (`other_activity`, `recurring_activity`, `recurring_remaining`, `uncategorized`), as magnitudes.
- `outflow` is every category row's `contribution` plus the summary's `totals.outflow.uncategorized` and `uncategorized_recurring` buckets.
- A budgeted category contributes its budget (budget + overspend when its `available` is negative); an unbudgeted category contributes its activity. Rows and the uncategorized buckets are summed with `sumBreakdownFields`.
- Non-budget spending still drains the leftover, via three routes:
  - Categories with no budget amount still appear in `/summary`'s category array with `budgeted: null`, so they contribute their activity.
  - Categories flagged `exclude_from_budget` are omitted from that array unless the request passes `include_exclude_from_budgets: true` (the widget always does), so budget-excluded spending is still counted.
  - Transactions with no category never appear in a category row at all; they only surface in the `totals.outflow.uncategorized` buckets.
- The only categories dropped from the leftover are income and categories flagged `exclude_from_totals`. `exclude_from_budget` alone never excludes a category from outflow.
- Groups: budgeted groups and budgeted children are mutually exclusive (`shouldCountEntry`) — a group row counts only when it holds its own budget with no budgeted children; otherwise its children count individually.

## Tap Navigation

Tap URLs target the Lunch Money web app (`https://my.lunchmoney.app`), then reroute through Scriptable via `appDeepLink`, which wraps each target in `scriptable:///run?scriptName=<this script>&url=<target url>`. The tap is picked up by `resolveTap()` → `tappedTarget()` and `presentWebPage()` in the SETUP section at the top of `index.js`: `resolveTap()` waits one tick (Scriptable can inject URL-scheme arguments a beat after a cold start, and treating a tap as a boot would close the app out from under the user; the tick is a native `Timer` — Scriptable's bare-JavaScriptCore runtime has no `setTimeout` global) then calls `tappedTarget()`, which reads the URL from `args.queryParameters.url` (URL-scheme arguments arrive there, not in `args.shortcutParameter`, which is Shortcuts-only); `presentWebPage()` then loads it into a Scriptable `WebView` that stays on screen until dismissed — so taps never leave Scriptable. `presentWebPage` presents full-screen (`present(true)`, not the non-fullscreen default sheet, so a cold-launch transition can't dismiss the page out from under the user), kicks off the load without awaiting it up front, and falls back to `Safari.open` if the presentation fails. A tap's only job is to show that page, so after the WebView closes the script ends there; the boot sequence (API key, widget render, `setWidget`) runs only for non-tap runs (widget renders, in-app previews, the API-key setup prompt). A tap whose `?url=` argument is lost in transit (still a URL-scheme launch, but no http(s) target) opens the plain transactions view instead of booting. Only a presented tap page calls `App.close()` — Scriptable's undocumented return-to-home-screen — and only after the user dismisses it (`present()` resolves on dismissal); the boot path never closes the app, so a cold-started tap whose arguments arrived late or not at all can't get sent straight home. `resolveTap()` short-circuits widget renders (`config.runsInWidget`) before the wait tick. Every target encodes the displayed period (via the period start date and a `time=custom` range), so taps open the same period the widget shows (the previous period when the `previous` parameter is set, the current period otherwise). Targets are set on stacks so each region deep-links where it should; the widget-wide url is the fallback (budget on the stacked small widget, the regular transactions view everywhere else):

- Tapping Inflow / Outflow / Leftover opens Lunch Money's budget section for the period. Budget deep-links by period start date: a monthly period anchors on the year/month (`https://my.lunchmoney.app/budget/YYYY/MM/`), and a custom period that doesn't start on the 1st adds its start day (`https://my.lunchmoney.app/budget/YYYY/MM/DD`). The small (stacked) widget and the extraLarge breakdown use this budget target too.
- Tapping the unreviewed transactions list opens transactions filtered by unreviewed + pending for the period (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&match=all&start_date=YYYY-MM-DD&status=unreviewed&include_pending=true&time=custom`)
- Tapping anywhere else opens the regular transactions list for the period, including pending transactions (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&include_pending=true&start_date=YYYY-MM-DD&time=custom`)

**Lock-screen accessory widgets** (accessoryCircular / accessoryRectangular / accessoryInline): `widget.url` is now set best-effort for all families including accessories (same `transactionsTapUrl(data)` fallback the home screens use). Scriptable is documented as ignoring `.url` on lock-screen families; if it honors it on a given iOS version, accessory taps work automatically with zero user configuration. When it doesn't, the manual per-widget "When Interacting: Open URL" path remains as a fallback: the user pastes a `scriptable:///run?scriptName=<name>` deep-link (with an optional `&parameter=previous` to match the widget's period). That tap arrives url-less — `tappedTarget()` returns `""`, `cameFromTap()` triggers `fallbackTapUrl()`, which fetches `/budgets/settings` (one request), derives the displayed period via `tapShowsPreviousPeriod()`, and returns `transactionsTapUrl({ periodStart, periodEnd })` — the same target `widget.url` carries for home screens. If the API key is missing or the settings fetch fails, it degrades to the plain `WEB_APP_URL + "/transactions"` rather than booting. `tapShowsPreviousPeriod()` reads the period flag in order: `args.queryParameters.parameter` (from the configured deep-link), then `args.widgetParameter` (normally empty for lock-screen taps), defaulting to current.

## Layout Conventions

- `FAMILY_LAYOUTS` holds one config per widget family (`small` / `medium` / `large` / `extraLarge` / `accessoryRectangular` / `accessoryCircular` / `accessoryInline`) plus an `undefined` fallback. Each config names its `layout` and a single `amount` size (all three money rows share one size), plus layout-specific fonts/caps (`caption`, `detailFont`, `payeeLen`) and per-layout `topPad` (small) / `headerPad` + `headerGap` (medium) / `padTop` + `padBottom` + `padSide` (accessory). The accessory circular layout shows a "Leftover" caption (9pt) above the amount (13pt), both fixed in the config and centered; the caption must stay smaller than the amount so the stacked pair fits the ring on every device. This fixed sizing replaced the older per-render fit test.
- Standard top/bottom padding is 14pt (`TOP_PAD`). The small widget uses a tighter 10pt `topPad`; the medium widget pushes its title down with a 6pt `headerPad` and closes the title→period gap with a 0pt `headerGap`. The header block nests title + period in its own stack so `headerGap` can differ from the mainStack spacing; `headerHeight` stays in sync via `headerBlockGap`/`headerBlockHeight`.
- Layout gaps are named constants (`REVIEW_GAP`, `OVERVIEW_GAP`, `LIST_BODY_GAP`) used in BOTH the renderers (`renderWidget`, `addOverview`, `addBreakdownSection`) and `listHeightBudget`, so a gap tweak never desyncs the rendered spacer from the row-fit math. Always update both sites together.
- Widget sizes come from `widgetSizes()` (keyed by longest device screen side, with X-class fallback) so budgets scale per device. The medium widget currently fits 4 rows (SE 1), 5 rows (most 148–155pt), or 6 rows (158–170pt); every device was verified to hold exactly this many.
- The medium review list and the row-fit function must stay in lockstep: `addTransactionRow` ends with a trailing `ROW_GAP` spacer that `rowFitHeight` reserves (`lineHeight(detailFont) + ROW_GAP`).

## Security Rules

- Never ask a user for their API key at any point in the process. Users should paste their own API key into the Scriptable app directly.
- Never access a user API key at any point in the process. If access to API data is needed, it should always go through the Mock API - https://mock.lunchmoney.dev/v2.

## Development Notes

- Verify syntax locally with `node --check index.js` — there is no lint or test suite
- The widget file cannot be required directly because it evaluates Scriptable globals (e.g. `new Font`) at load. Pure logic can instead be extracted and run in plain Node: the leftover math between `function indexCategories(` and `function formatMoney(` (exercised against the mock API), the tap-URL builders (`periodPathParts` … `transactionsTapUrl`), and the calendar helpers (`addBudgetPeriod` … `periodLabelFor`).
- Mock API behavior (https://mock.lunchmoney.dev/v2): `/categories` is stable across calls, but `/summary` returns varying data on every request and requires `start_date`/`end_date` (400 otherwise). Verify with relative invariants (e.g. outflow rows + uncategorized buckets = total outflow), not fixed expected numbers.
- Functional behavior must be verified on an iOS device via Scriptable (widget families: small / medium / large / extraLarge / accessoryCircular / accessoryRectangular / accessoryInline; the SE 1st gen has no lock-screen widgets and falls back to the X-class accessory spec)
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow
- `FAMILY_LAYOUTS` uses one `amount` size for all three money rows; layouts pick their own row ORDER, so don't reintroduce per-metric-size duplication
- `METRICS` is the single source for the three money rows (label, value closure, sign color); `addMetrics`, `addMetricRow`, and `addBreakdown` all render from it, so layouts only choose row order and one `amount` size. Leftover's color is decided in `addAmount` (green when positive, red when negative)
- Inner widths come from `WIDGET_INNER_WIDTH` (container width minus the 10pt side padding). The medium review split uses `METRICS_WEIGHT`/`LIST_WEIGHT` (31/69 — layoutWeight units summing to 100) and `LIST_COLUMN_WIDTH` for the list column
- Secondary text derives from one size source, `detailFontSize(config[, fallback])`; `timestampFont` and the failed-unreviewed hint subtract from it, so a size tweak lands everywhere

## Git Workflow

- Commit changes when finalized; never push to a remote
- Commit messages use conventional prefixes: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`