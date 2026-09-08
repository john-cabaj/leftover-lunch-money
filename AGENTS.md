## Project Overview

An iOS widget built with [Scriptable](https://scriptable.app) that shows a reflection of the leftover money from [LunchMoney](https://my.lunchmoney.app) for a given period, along with a list of unreviewed transactions for that same period. "Leftover" is the amount remaining after income and spending for the period.

## Architecture

- Single-file widget: `index.js`
- Runs in Scriptable app on iOS
- Communicates with LunchMoney API
- Pulls period totals and unreviewed transactions, computes period leftover
- Caches data in iCloud (2-hour refresh)

## Widget Parameters

- `previous` — shows the budget period before the current one
- `current` (or empty/no value) — shows the current budget period (default)
- Matching is case-insensitive, whitespace trimmed; cache is split per period

## Tap Navigation

Tap URLs always include the displayed period's `start_date`/`end_date` so taps open the same period the widget shows (not just the current one).

- Tapping Inflow/Outflow/Leftover opens Lunch Money's budget section for the period (`lunchmoney://budget?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`)
- Tapping the unreviewed transactions list opens transactions filtered by unreviewed for the period (`lunchmoney://transactions?status=unreviewed&include_pending=true&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`)
- Tapping anywhere else opens the regular transactions list for the period (`lunchmoney://transactions?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`)

## Security Rules

- Never ask a user for their API key at any point in the process. Users should paste their own API key into the Scriptable app directly.
- Never access a user API key at any point in the process. If access to API data is needed, it should always go through the Mock API - https://mock.lunchmoney.dev/v2.

## Development Notes

- No build process or dependencies — just a single JavaScript file
- All code lives in `index.js`
- Tested via Scriptable app on iOS devices
