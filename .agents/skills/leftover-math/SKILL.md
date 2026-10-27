---
name: leftover-math
description: Use when working with the widget's leftover-money math in index.js — computeLeftover, incomeInflow, inflow/outflow, budgeted categories, /summary uncategorized buckets, group mutual exclusion, or verifying the math against the mock API. Load before touching anything between function indexCategories( and function formatMoney(.
---

# Leftover Math

The widget's period leftover is computed in `index.js` by `computeLeftover` and its helpers (the block between `function indexCategories(` and `function formatMoney(`). This spec is authoritative — apply these rules before changing any of that code.

## Core equation

`computeLeftover` is budget-based, not spend-based: `leftover = inflow − outflow`.

## inflow

`inflow` is the period's income under Lunch Money's "max" budget-income option applied PER CATEGORY, plus the `rollover_pool.budgeted_to_base` balance — together the general pool Lunch Money calls "budgetable" (this period's income plus money carried into it). `incomeInflow` sums: for each counted income category, take `their totals.budgeted` as the expected figure and `other_activity` + `recurring_activity` as the realized figure, and count the larger of the two per category. A category that overperforms its budget counts its full realized income; a budgeted-but-unreceived category still counts its full budget. Per-category (not a max of the two global sums) is what keeps an over-budget source from being masked by an under-budget one, and it lands exactly on the summary's own `totals.inflow.recurring_expected` (realized income + budgets still to arrive).

Income observes the same group/children mutual exclusion as outflow rows, and categories flagged `exclude_from_totals` (transfers, reimbursements, etc.) never count. The `totals.inflow` breakdown is not consulted — expected income is the income budget set for the period, not a projection of transactions still to come.

## outflow

`outflow` is every category row's `contribution` plus the summary's `totals.outflow.uncategorized` buckets (the two uncategorized columns summed via `OUTFLOW_FIELDS`).

A budgeted category contributes its budget (budget + overspend when its `available` is negative); an unbudgeted category contributes its activity. Rows and the uncategorized buckets are summed with `sumBreakdownFields`.

## Non-budget spending still drains the leftover

- Categories with no budget amount still appear in `/summary`'s category array with `budgeted: null`, so they contribute their activity.
- Categories flagged `exclude_from_budget` are omitted from that array unless the request passes `include_exclude_from_budgets: true` (the widget always does), so budget-excluded spending is still counted.
- Transactions with no category never appear in a category row at all; they only surface in the `totals.outflow.uncategorized` buckets.

## Categories dropped from the leftover

Only income and categories flagged `exclude_from_totals` are dropped. `exclude_from_budget` alone never excludes a category from outflow.

## Groups

Budgeted groups and budgeted children are mutually exclusive (`shouldCountEntry`): a group row counts only when it holds its own budget with no budgeted children; otherwise its children count individually.

## Recurring-planning is not used

Lunch Money's separate recurring-planning section is intentionally not leveraged: expected income is the income budget, and every spending commitment comes from a category's budget/activity — never from a recurring projection.

## Verifying against the mock API

- The widget file cannot be required directly because it evaluates Scriptable globals (e.g. `new Font`) at load. The leftover math between `function indexCategories(` and `function formatMoney(` can be extracted and run in plain Node against the mock API.
- Mock API (https://mock.lunchmoney.dev/v2): `/summary` returns varying data on every request and requires `start_date`/`end_date` (400 otherwise). Verify with relative invariants (e.g. outflow rows + uncategorized buckets = total outflow), not fixed expected numbers.

## Pinned as tests

The rules above are already executable: `test/pure-core.test.js` takes the real `computeLeftover` region straight from `index.js` by marker and pins the invariant arithmetic on a hand-built fixture (budgeted, over-budget, unbudgeted, `exclude_from_totals`, `exclude_from_budget`-only, and group/child rows) under `describe('computeLeftover')`, `describe('per-category income max …')`, and `describe('group / child mutual exclusion')`. When you change the math, run `node --test test/*.test.js` and keep those tests green — or update the fixture/assertions deliberately in the same change. The harness slices `index.js` by function-signature markers; keep the boundary comments and signatures intact (they are the slice anchors).