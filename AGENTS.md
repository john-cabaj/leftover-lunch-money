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

Tap URLs point at the Lunch Money web app (`https://my.lunchmoney.app`) rather than the installed app, so taps open in the browser. Every target encodes the displayed period (via the period start date and a `time=custom` range), so taps open the same period the widget shows (the previous period when the `previous` parameter is set, the current period otherwise). Targets are set on stacks so each region deep-links where it should; the widget-wide url is the fallback (budget on the stacked small widget, the regular transactions view everywhere else):

- Tapping Inflow / Outflow / Leftover opens Lunch Money's budget section for the period. Budget deep-links by period start date: a monthly period anchors on the year/month (`https://my.lunchmoney.app/budget/YYYY/MM/`), and a custom period that doesn't start on the 1st adds its start day (`https://my.lunchmoney.app/budget/YYYY/MM/DD`). The small (stacked) widget and the extraLarge breakdown use this budget target too.
- Tapping the unreviewed transactions list opens transactions filtered by unreviewed + pending for the period (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&match=all&start_date=YYYY-MM-DD&status=unreviewed&include_pending=true&time=custom`)
- Tapping anywhere else opens the regular transactions list for the period, including pending transactions (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&include_pending=true&start_date=YYYY-MM-DD&time=custom`)

## Layout Conventions

- `FAMILY_LAYOUTS` holds one config per widget family (`small` / `medium` / `large` / `extraLarge`) plus an `undefined` fallback. Each config names its `layout` and a single `amount` size (all three money rows share one size), plus layout-specific fonts/caps (`caption`, `detailFont`, `payeeLen`) and per-layout `topPad` (small) / `headerPad` + `headerGap` (medium).
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
- Functional behavior must be verified on an iOS device via Scriptable (widget families: small / medium / large / extraLarge)
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow
- `FAMILY_LAYOUTS` uses one `amount` size for all three money rows; layouts pick their own row ORDER, so don't reintroduce per-metric-size duplication
- `METRICS` is the single source for the three money rows (label, value closure, sign color); `addMetrics`, `addMetricRow`, and `addBreakdown` all render from it, so layouts only choose row order and one `amount` size. Leftover's color is decided in `addAmount` (green when positive, red when negative)
- Inner widths come from `WIDGET_INNER_WIDTH` (container width minus the 10pt side padding). The medium review split uses `METRICS_WEIGHT`/`LIST_WEIGHT` (31/69 — layoutWeight units summing to 100) and `LIST_COLUMN_WIDTH` for the list column
- Secondary text derives from one size source, `detailFontSize(config[, fallback])`; `timestampFont` and the failed-unreviewed hint subtract from it, so a size tweak lands everywhere

## Git Workflow

- Commit changes when finalized; never push to a remote
- Commit messages use conventional prefixes: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`