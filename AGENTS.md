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

## Security Rules

- Never ask a user for their API key at any point in the process. Users should paste their own API key into the Scriptable app directly.
- Never access a user API key at any point in the process. If access to API data is needed, it should always go through the Mock API - https://mock.lunchmoney.dev/v2.

## Development Notes

- Verify syntax locally with `node --check index.js` — there is no lint or test suite
- Functional behavior must be verified on an iOS device via Scriptable (widget families: small / medium / large / extraLarge)
- Keep every size/measurement a named constant; row budgets derive from the real widget container size so lists never overflow

## Git Workflow

- Commit changes when finalized; never push to a remote
- Commit messages use conventional prefixes: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`