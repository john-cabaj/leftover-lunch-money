---
name: testing
description: Use when working with the pure-logic test suite in test/pure-core.test.js — adding a case, changing a golden URL, moving an extraction marker, extending the layout fit spec, or debugging a suite failure. Also use when a release needs its verification step (what the suite covers and what it does not) and when deciding whether a change needs a new test.
---

# Testing

`test/pure-core.test.js` is the widget's safety net: it pins the pure functions **to the file as it actually is**, so a change to `index.js` cannot drift away from what is asserted.

## How the suite reaches the code

`index.js` cannot be required: it evaluates Scriptable globals (`new Font`, `Color`, `config`) at load and runs top-level await. So the suite slices the real source by **byte range** and evaluates the slices in a shared VM context — there is no second copy of the logic to drift.

The seven slices (markers in `index.js` are the anchors; a missing or inverted marker throws, which is the suite's way of refusing to test nothing):

| Slice | From | To | Holds |
|---|---|---|---|
| 1 | `function buildQueryString(params) {` | the `LEFTOVER CALCULATION` banner | `buildQueryString` — the shared query-string encoder |
| 2 | `function indexCategories(categories) {` | `function formatMoney(value) {` | the leftover calculation (`indexCategories`, `categoryRows`, `incomeInflow`, `computeLeftover`, `sumBreakdownFields`) |
| 3 | `function formatMoney(value) {` | the `STORAGE` banner | the utilities: money/date formatting and the period math (`addBudgetPeriod`, `getPeriodRange`, `reconcilePeriodRange`, `periodLabelFor`, …) |
| 4 | `function carryForwardSideList(` | `// GET request against the Lunch Money API:` | the side-list carry-forward and the per-field recency fallback |
| 5 | `function periodPathParts(data) {` | the `/summary` breakdown comment | the tap/URL builders (`periodPathParts`, `budgetTapUrl`, `transactionPageUrl`, `unreviewedTapUrl`, `deletePendingTapUrl`, `updateTapUrl`, `appDeepLink`, …) |
| 6 | `const LINE_HEIGHT_FACTOR = 1.15;` | `const LAYOUT_RENDERERS = {` | the layout constants and `FAMILY_LAYOUTS` |
| 7 | `function listHeightBudget(data, config) {` | `function smallDetailSize(config, fallback) {` | the list budgets |

**Keep the boundary comments and function signatures intact.** A moved marker silently changes *what* is tested — the suite will still pass while asserting less. When a function moves, re-check that its slice still contains it.

## The sandbox

- `BASE_GLOBALS` is the small set of built-ins the slices may use; anything else a slice touches has to be provided.
- `OBJ(value)` defines a value as an enumerable own property, so cross-realm objects survive the VM boundary (a plain literal does not).
- `srcConst(name)` reads a named constant's literal **from the real file** (`const NAME = …;`) instead of copying it, so the sandbox can never disagree with `index.js` about e.g. `SCRIPT_VERSION`.
- The `Font` stub deliberately has **no** `.lineHeight`, so the layout math walks the shipped fallback factors — exactly what a runtime without `Font.lineHeight` uses on device. `Device.screenSize()` is stubbed per virtual screen, and each screen gets a fresh context.
- `MAX_MONEY` is computed by running the real `formatMoney` first, because the layout regions call `smallAmountFont()` at module init, before the full context is mounted.

## Golden values

The tap URLs are asserted as hardcoded golden strings ("the `scriptable:///run?scriptName=<name>&url=<encodeURIComponent(target)>` envelope, `delete pending`'s encoding, the no-period fallbacks"). **A deliberate change to a target's shape must update its golden in the same change** — and the change message should say why the target moved. The same applies to the layout matrices (below) and to the leftover/period expectations.

## What the suite covers

`formatMoney` · `computeLeftover` and its invariants (including group/child mutual exclusion and the per-category income max) · `carryForwardSideList` and `sideListUpdatedAt` · `addBudgetPeriod` / `getBudgetPeriodForDate` / `periodLabelFor` / `reconcilePeriodRange` / `periodIsFullMonth` · the tap URL builders (golden) · the update tag logic (`tagVersion`, `newestTag`, `isNewerVersion`) · the widget layout fit math.

The **fit spec** — the device tables, row pitches, list budgets, fitted row counts and the badge reserve — lives in the `widget layout (deterministic fit math)` spec at the end of the file, and the `widget-layout` skill's Verification section is its reference (regions, stubs, pinned matrices, recalibration workflow). It is layout knowledge: keep it there, and keep the two in sync when the numbers move.

## What the suite does not cover

The **boot path**: the file's Scriptable globals, the API calls, the cache, and the actual rendering. The suite is headless pure logic; a full render or tap flow needs a stub harness (Scriptable globals + a mock API), and no such harness ships in the repo today. Until one does, the only end-to-end check is an on-device Scriptable run — say so rather than claiming the suite proved it.

## Running and extending

- `node --test test/*.test.js` (the pre-commit hook runs it whenever `index.js` or `test/` changes; `node --check index.js` guards syntax).
- To add a case for a pure function: make sure it sits inside one of the seven slices, expose it in `loadPureLogic()`, then assert it. If a new pure function needs testing, either widen an existing slice's marker or add a slice — and keep the boundary comments intact.
- To add a layout expectation: extend the fit spec's pinned matrix, and update the `widget-layout` skill's Verification reference if the numbers move.
