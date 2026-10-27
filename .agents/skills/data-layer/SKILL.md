---
name: data-layer
description: Use when working with the widget's API and cache layer in index.js — sendLunchMoneyRequest, lunchMoneyLeftoverInfo, getAllData, readCache, writeCache, sweepWidgetStorage, fetchUnreviewedTransactions, fetchDeletePendingTransactions, carryForwardSideList, sideListUpdatedAt, the cache TTL, or the mock API (https://mock.lunchmoney.dev/v2). Also use when a fetch fails, a widget shows stale or missing data, the unreviewed list or the Delete Pending badge goes wrong, or a release must verify against the Mock API.
---

# Data Layer

How the widget gets its numbers and what it does when the network does not cooperate. The rules here are about *failure* — every one of them exists because a fetch can fail, return something unexpected, or be interrupted.

## One request rule, and it is strict

`sendLunchMoneyRequest(path, params)` builds the query string, sends the Bearer token, and **throws on any non-2xx status**. The API answers errors with JSON bodies (a 401 is `{"message":"Unauthorized"}`), and `loadJSON` would happily parse those as data — so the status check is what stops an error body from being cached as a result. The API's `{message, errors}` envelope is treated as an error too, which is what keeps a bad key failing safely when the runtime did not populate `request.response` (the status then defaults to 200).

The same rule applies to a 200 with the wrong shape: `lunchMoneyLeftoverInfo` returns `null` when `computeLeftover` yields no leftover, and `fetchTransactions` throws when the body has no `transactions` array. A malformed 200 is a **failed fetch**, never an empty result. That distinction is what keeps a bad response from being written to the cache with a fresh timestamp (which would look like real data for ten minutes).

## The assembly order

`lunchMoneyLeftoverInfo(previous)`:

1. `/budgets/settings` → the budget period seed (`getPeriodRange`; the calendar month is the fallback).
2. In parallel: `/summary` (with `include_occurrences` + `include_past_budget_dates`), `/categories`, the unreviewed `/transactions` pull, the delete-pending `/transactions` pull.
3. `reconcilePeriodRange` adopts the API's own period boundaries (see the `budget-periods` skill). When the seed missed the real period, the `/summary` is refetched pinned to the corrected range and the unreviewed rows are repulled for it — a misaligned summary omits the budgeted/available fields the leftover math needs.
4. `computeLeftover` (see the `leftover-math` skill).
5. Each side list is carried forward on its own.

## The two side lists, and their three states

The unreviewed rows and the delete-pending count are fetched independently of the headline totals, and each reports a status so the layout can tell *nothing to show* from *nothing known*:

- `ok` — the fetch worked and returned something.
- `empty` — the fetch worked and there is genuinely nothing (no unreviewed transactions, no pending deletes). The badge hides; the list shows its empty state.
- `failed` — the fetch did not work. The badge hides **and** the list must not claim "you're all caught up".

`carryForwardSideList` decides what a failed side list shows: it keeps the previous record's last good value **and its original timestamp** (so a transient error cannot wipe known-good data, and cannot relabel stale data as fresh), reporting `stale` when it carried something forward and `failed` when there was nothing to carry. `sideListUpdatedAt` reads each list's own per-field stamp, falling back to the record's `lastUpdated` for records written before those stamps existed.

Two details that are easy to get wrong:

- The unreviewed pull filters **client-side**, so both v1 (`uncleared`) and v2 (`unreviewed`) statuses count, and group rows and `delete_pending` rows are excluded.
- The delete-pending pull sends **no date filter** — manual deletes are period-independent, so the count covers the account's whole history, not the displayed period. Its status is period-independent too: the badge costs the same row reserve whichever period the widget shows.

## The cache

- Two files, one per period (`lunchMoneyCache`, `lunchMoneyCache_previous`), so a "previous" run never serves the current period's data. The update-check record is a **third** file, deliberately outside them (it is not period data) — see the `update-check` skill.
- Freshness is `CACHED_MS` (10 minutes), gated on the cache file's modification time. `readCache()` returns a fresh record; `readCache(true)` also returns a stale one — that is the offline fallback and the source a failed side-list pull carries forward from.
- `getAllData` is the whole fallback chain: fresh cache → fetch → stale cache. A cache record written before the `lastUpdated` field existed gets one retroactively from the file's mtime (`stampCacheTime`), so the widget can always show when the data was fetched.
- Writes are best-effort: a failed write must not discard freshly fetched data, so the widget renders this run and the next run simply re-fetches.
- `sweepWidgetStorage` is the janitor: it deletes every entry in the widget folder that is not one of the two cache files or the update record, so retired files and OS cruft cannot linger on device. It runs on the boot path, is idempotent, and never touches what it must keep.

## The API key

The key comes from the iOS Keychain and is never asked for by the widget itself: a widget render cannot present the setup prompt, so `getApiKey` returns an empty key when `config.runsInWidget` is true and the widget shows its setup state instead of erroring. **Never access a user API key, and never ask for one** — all data verification goes through the Mock API.

## The Mock API

Base URL `https://mock.lunchmoney.dev/v2`, with its own behavior:

- `/categories` and `/budgets/settings` are stable across calls.
- `/summary` returns **varying** data on every request, and requires `start_date`/`end_date` (400 without them).
- It rate-limits: the responses carry `x-ratelimit-limit` / `x-ratelimit-remaining` (100 as observed). A loop of widget runs will 429 — back off and retry, and answer repeated identical requests from memory.

## Verification

Verify with **relative invariants, never fixed numbers** — `/summary` varies per call, so a hardcoded expectation is a flaky test.

- The leftover invariants (outflow rows + uncategorized buckets = total outflow; leftover = inflow − outflow; inflow = per-category max income + rollover; a group and its children never both count) belong to the `leftover-math` skill.
- The data layer's own: a failed fetch never caches a result; a failed side-list pull carries the previous value with its **original** timestamp; an empty list and a failed pull render differently; the cache TTL and the stale fallback behave; the sweep keeps the three files it must and deletes the rest.
- The pure half of this area is already covered: `carryForwardSideList` and `sideListUpdatedAt` are extracted by the test suite (see the `testing` skill).
