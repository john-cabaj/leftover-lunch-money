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

## Tap Navigation

Tapping anywhere on the widget opens Lunch Money's transactions view (`lunchmoney://transactions`).

## Layout Conventions

- `FAMILY_LAYOUTS` holds one config per widget family (`small` / `medium` / `large` / `extraLarge`) plus an `undefined` fallback. Each config names its `layout` and a single `amount` size (all three money rows share one size), plus layout-specific fonts/caps (`caption`, `detailFont`, `payeeLen`) and per-layout `topPad` (small) / `headerPad` (medium).
- Standard top/bottom padding is 14pt (`TOP_PAD`). The small widget uses a tighter 10pt `topPad`; the medium widget pushes its title down with a 2pt `headerPad`.
- Layout gaps are named constants (`REVIEW_GAP`, `OVERVIEW_GAP`, `LIST_BODY_GAP`) used in BOTH the renderers (`renderWidget`, `addOverview`, `addBreakdownLayout`) and `listHeightBudget`, so a gap tweak never desyncs the rendered spacer from the row-fit math. Always update both sites together.
- Widget sizes come from `widgetSizes()` (keyed by longest device screen side, with X-class fallback) so budgets scale per device. The medium widget currently fits 4 rows (SE 1), 5 rows (most 148–155pt), or 6 rows (158–170pt); every device was verified to hold exactly this many.
- The medium review list and the row-fit function must stay in lockstep: `addTransactionRow` ends with the same trailing 1pt spacer that `rowFitHeight` reserves (`lineHeight(detailFont) + 1`).

## Security Rules

- Never ask a user for their API key at any point in the process. Users should paste their own API key into the Scriptable app directly.
- Never access a user API key at any point in the process. If access to API data is needed, it should always go through the Mock API - https://mock.lunchmoney.dev/v2.

## Development Notes

- Verify syntax locally with `node --check index.js` — there is no lint or test suite
- Functional behavior must be verified on an iOS device via Scriptable (widget families: small / medium / large / extraLarge)
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow
- `FAMILY_LAYOUTS` uses one `amount` size for all three money rows; layouts pick their own row ORDER, so don't reintroduce per-metric-size duplication

## Git Workflow

- Commit changes when finalized; never push to a remote
- Commit messages use conventional prefixes: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`