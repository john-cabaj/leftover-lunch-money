---
name: finalize-release
description: Use ONLY when the user explicitly asks to finalize a release and establish a baseline — the "simplify and generalize logic where applicable, refactor where appropriate, add or update code comments, and verify identical functionality" workflow. Do NOT trigger on ordinary simplify/refactor/cleanup edits outside an explicit release-finalization request.
---

# Finalize Release

Release-milestone workflow for the leftover-lunch-money widget. Run only when the user explicitly asks to finalize a release and indicate a baseline; it is a deliberate, milestone-level pass over the whole widget, not a routine cleanup.

## When to use

- The user says "finalize a release", "establish/indicate a baseline", or asks for the simplify + refactor + comment + verify sequence.
- Do NOT apply to ordinary refactor/simplify edits made mid-change or outside an explicit release request.

## Workflow

### 1. Simplify and generalize logic where applicable

Consolidate duplication toward the code's single sources of truth (see below) and generalize only where it removes real duplication — never restructure for its own sake. Prefer smaller obviously-correct code over clever.

### 2. Refactor where appropriate

Refactor only with a clear payoff, and never against this repo's always-on rules:

- Load the relevant domain skill BEFORE touching its area (`leftover-math` for `computeLeftover`/`indexCategories`, `widget-layout` for any renderer/size/fit code, `tap-navigation` for any URL/tap code, `budget-periods` for any period/date code) and follow it as the authoritative spec.
- Never violate the AGENTS.md invariants that always hold: gaps used in BOTH renderers and `listHeightBudget` stay in sync; every size/measurement stays a named constant; `FAMILY_LAYOUTS` keeps one `amount` size for the three money rows; taps never leave Scriptable and only a presented tap page calls `App.close()`; the small widget's single tap target is Budget.
- Security Rules never change: never ask for or access a user API key; API data flows through the Mock API only.

### 3. Add or update code comments

Update comments to match the final behavior so they document intent, not history; remove any that became stale during the refactor. Comment the why (WidgetKit quirks, off-by-one derivations) rather than restating the code.

### 4. Verify identical functionality

Behavior must be provably unchanged except where the refactor intentionally simplified it. At minimum:

- `node --check index.js` and the pure-logic test suite: `node --test test/*.test.js` — it extracts the pure functions straight from `index.js` by marker (no duplicated logic to drift), so it pins the leftover math, period math, and tap-URL builders to the file as it actually is.
- Exercise any not-yet-covered pure logic in plain Node against the mock API (https://mock.lunchmoney.dev/v2) using the relative invariants from the domain skills (`/summary` variant data — verify balance invariants like outflow rows + uncategorized buckets = total outflow, never fixed numbers).
- Watch the `widget-layout` calibration knobs: if a fitted row count or the small-widget badge line changes as a side effect, treat it as a red flag, not a pass.
- Confirm stable behavior across current vs `previous` period, all widget families (small / medium / large / extraLarge / accessoryCircular / accessoryRectangular / accessoryInline), and the Delete Pending state — and note that on-device verification via Scriptable is still required for visual/layout confirmation.

### 5. Update CHANGELOG.md

- Reconcile first: every existing `refs/tags/vN` must have a `## vN — YYYY-MM-DD` heading. If the user tagged a release manually (outside this workflow), the changelog drifted — add the missing entry retroactively before the new one. The pre-commit hook enforces this: an unsynced tag blocks the next commit, so reconcile in this step rather than stalling a later commit.
- Add the release entry describing user-visible changes since the last `refs/tags/vN`. Follow the file's existing wording style and conventional prefixes.

## Establish the baseline

When verification passes:

- Commit the finalized changes with a conventional prefix per Git Workflow (write concise messages; never push). The CHANGELOG entry travels with the release commit.
- ONLY if this finalize is creating a NEW tag (a release bump): move every
  reference to the PREVIOUS release tag up to the new one. Grep the whole repo
  for the old tag name (e.g. `v5`); the surviving spot at release time is
  usually `README.md`'s raw install link (`.../refs/tags/vN/index.js`). Update
  each hit, commit with a `docs:` prefix, and if that commit lands after the
  tag was created, move the tag to the new HEAD so the baseline is the final
  commit. Never push. If the finalize is a code pass WITHOUT a new tag, skip
  this step entirely — pointing references at a tag that doesn't exist would
  break the install link.
- Confirm the baseline marker with the user (e.g. the release version/tag name — the repo uses `refs/tags/vN` releases); create the tag locally as the baseline. Never push.
- Report the final message and tag clearly as the baseline in your response.