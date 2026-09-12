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

Tapping anywhere on the widget opens Lunch Money's transactions view (`lunchmoney://transactions`).

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
- The leftover math can be exercised in plain Node: extract the section of `index.js` between `function indexCategories(` and `function formatMoney(` and run it against the mock API. `index.js` cannot be required directly because it evaluates Scriptable globals (e.g. `new Font`) at load.
- Mock API behavior (https://mock.lunchmoney.dev/v2): `/categories` is stable across calls, but `/summary` returns varying data on every request and requires `start_date`/`end_date` (400 otherwise). Verify with relative invariants (e.g. outflow rows + uncategorized buckets = total outflow), not fixed expected numbers.
- Functional behavior must be verified on an iOS device via Scriptable (widget families: small / medium / large / extraLarge)
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow
- `FAMILY_LAYOUTS` uses one `amount` size for all three money rows; layouts pick their own row ORDER, so don't reintroduce per-metric-size duplication

## Git Workflow

- Commit changes when finalized; never push to a remote
- Commit messages use conventional prefixes: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`