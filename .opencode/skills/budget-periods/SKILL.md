---
name: budget-periods
description: Use when working with budget-period and date resolution in index.js — addBudgetPeriod, getBudgetPeriodForDate, getCurrentBudgetPeriod, getPreviousBudgetPeriod, getPeriodRange, getCalendarMonthRange, periodLabelFor, the /budgets/settings fields, or the widget's current/previous period selection.
---

# Budget Periods

Budget-period and date-resolution spec for the widget. Apply these rules before touching any period/date code.

## Where periods come from

The account's budget period comes from Lunch Money's `/budgets/settings`:

- `budget_period_anchor_date` — the anchor date periods are walked from
- `budget_period_quantity` — the number of periods per step (default 1)
- `budget_period_granularity` — `day` / `week` / `year` / `twice a month` / `month` (`month` is the default and the behavior for any unexpected value)
- `budget_use_last_day_of_month` — when set (month granularity only), a period's end stretches to the last day of its calendar month; otherwise a period ends the day before the next period starts

When the account has no custom period (empty `/budgets/settings` or absent anchor), the calendar month is used instead via `getCalendarMonthRange`.

## Widget parameter selection

The Scriptable widget parameter (case-insensitive, whitespace-trimmed) selects the period:

- `previous` shows the budget period before the current one
- `current` (or empty/missing) shows the current period

The cache is split per period (`lunchMoneyCache` / `lunchMoneyCache_previous`), so a "previous" request never serves the current period's data (or vice versa).

## Walking periods: `addBudgetPeriod`

`addBudgetPeriod(date, settings, count)` steps `date` by `count` budget periods (positive forward, negative back), moving in increments of `quantity` at each step of `granularity`. Backward walking is how callers find the period before a given target date. Special cases:

- `year`: Feb 29 crossings clamp to the prior month's last day
- `month` (default): `addMonthsClamped` shifts by n months but clamps the day so Jan 31 never overflows into March
- `twice a month`: steps 15 days
- `week`: 7 days; `day`: 1 day

## Finding the period containing a date

`getBudgetPeriodForDate(settings, targetDate)` walks the anchor until the period containing the target is found (forward normally, backward when the anchor sits in the future). Returns `{ start_date, end_date }` as formatted strings. `periodEnd` is the day before the next period's start, unless `budget_use_last_day_of_month` (month granularity) stretches it to the calendar month's last day.

- `getCurrentBudgetPeriod(settings)` — the budget period containing today.
- `getPreviousBudgetPeriod(settings)` — the period containing the day BEFORE the current period's start. It is derived from the current period's start date, not merely "one period ago", so boundary/off-by-one cases stay correct.
- `getPeriodRange(settings, previous)` — the widget's displayed range: the custom budget period, or the calendar-month fallback (`getCalendarMonthRange`, offset 0 = current calendar month, -1 = previous).

## Period label

`periodLabelFor(settings, range)` formats the header label:

- Non-month granularity: `"CURRENT PAY PERIOD"` or `"PREVIOUS PAY PERIOD"` (per `SHOW_PREVIOUS_PERIOD`).
- Month-based: the month name in caps (e.g. `JUNE`); when the range straddles two months, a range label (e.g. `JUNE–JULY`).

## Unreviewed transactions

Unreviewed transactions are fetched for the same range as the displayed period, filtering client-side so both v1 ("uncleared") and v2 ("unreviewed") statuses are recognized.

## Node verification

The calendar/period helpers (`addBudgetPeriod` … `periodLabelFor`) don't depend on Scriptable globals, so they can be extracted and run in plain Node — and they already are. `test/pure-core.test.js` slices this region out of `index.js` by marker and pins it under `describe('addBudgetPeriod')`, `describe('getBudgetPeriodForDate')`, and `describe('periodLabelFor')`: Jan 31 clamping (leap and non-leap), year-granularity Feb 29, negative steps, quantity > 1, period boundaries, bi-monthly and daily granularity, `use_last_day_of_month`, and label cases. Change this code with `node --test test/*.test.js` green — or update the assertions deliberately. The harness slices `index.js` by function-signature markers; keep the boundary comments and signatures intact (they are the slice anchors).