# Changelog

All notable changes to this widget. Releases follow the repo's `refs/tags/vN`
tags; commit messages use conventional prefixes (`fix:`, `feat:`, `refactor:`,
`style:`, `docs:`).

## v4 — 2026-10-06

- `docs`: moved AGENTS.md's domain rules into on-demand opencode skills and
  slimmed it down (~76% token reduction); existing rules now load via the
  `leftover-math`, `widget-layout`, `tap-navigation`, `budget-periods`, and
  `finalize-release` skills.
- `refactor`: add a deterministic node:test suite (`test/pure-core.test.js`)
  that extracts the pure logic from `index.js` by marker and evaluates it in
  plain Node (no Scriptable runtime needed); it also re-runs the layout/fit
  math headlessly per known iPhone screen (stubbed `Device.screenSize()` /
  `Font` with no `.lineHeight`, so the shipped fallback factors apply) and pins
  the device tables, per-family row pitches, Delete Pending badge reserves,
  the small-amount font, and the "rows never overflow the budget" invariant.
- `fix`: `addMonthsClamped` rolled Jan 31 → Mar 29 when shifting a month; it
  now clamps to Feb 28/29 as documented (caught by the new suite).
- `refactor`: `index.js` gains a SECTION INDEX banner.
- `docs`: add CHANGELOG; pre-commit (`node --check` + tests) and commit-msg
  (conventional prefix) git hooks in `.githooks/` installed to `.git/hooks/`.

## v3 — 2026-09-23

- `feat`: add Delete Pending label linking to `delete_pending` transactions
  (all of them, unfiltered by date), topping the unreviewed column on
  home-screen widgets and the metrics on the small stacked widget.

## v2 — 2026-09-19

- `feat`: add scaled layouts for lock-screen accessory widgets.
- `fix`: take the larger of expected and actual income as inflow (per-category
  max of budget vs realized; over-performing income categories no longer get
  masked down to their budget).

## v1 — 2026-09-13

- `fix`: limit the unreviewed tap target to the label and list rows instead of
  the whole column.
- Initial release.