---
name: finalize-release
description: Use ONLY when the user explicitly asks to finalize a release and establish a baseline — the "simplify and generalize logic where applicable, refactor where appropriate, add or update code comments, and verify identical functionality" workflow, scoped to the areas changed since the last release tag. Do NOT trigger on ordinary simplify/refactor/cleanup edits outside an explicit release-finalization request.
---

# Finalize Release

Release-milestone workflow for the leftover-lunch-money widget. Run only when the user explicitly asks to finalize a release and indicate a baseline.

## When to use

- The user says "finalize a release", "establish/indicate a baseline", or asks for the simplify + refactor + comment + verify sequence.
- Do NOT apply to ordinary refactor/simplify edits made mid-change or outside an explicit release request.
- If the user asks for a whole-widget pass ("review everything", "full sweep"), skip the scoping below and run every area.

## Scope: only the areas the release touches

A release is a set of changes, not a reason to re-review the whole widget. The five steps run over the areas that changed since the last release tag; untouched areas get no renaming, no re-reading of their skills, and no separate verification. Step 5 (the changelog) and the baseline stay global — they describe the release as a whole.

### Step 0 — find the scope

Run the tool — it does the git work and the owner→area mapping:

```sh
node tools/release-scope.mjs
```

It prints the boundary tag, the changed files, every `index.js` hunk's owner, the areas **in scope** (with the skills to load), the areas **out of scope**, and the verification commands for the in-scope areas. `--json` prints the same report machine-readably; `--tag vN` uses a different boundary.

The area map lives in `tools/release-scope.areas.json` — the single source of truth, guarded by `test/repo-consistency.test.js`. It lists every top-level symbol in `index.js` and the area that owns it:

| Area | Domain skill |
|---|---|
| Leftover math | `leftover-math` |
| Period math | `budget-periods` |
| Layout & render | `widget-layout` |
| Tap routing & URLs | `tap-navigation` |
| Update check | `update-check` |
| Data layer & storage | `data-layer` |
| Tests & harness | `testing` |

The tool's findings still need a human decision:

- **Unclassified hunks** — a symbol the map does not know (a shared constant, a new helper). It prints the region as a hint. Pick the area by what it feeds; if it could touch more than one, treat every one of them as in scope. When in doubt, widen — a widened scope only costs time; a wrongly narrowed one ships unverified code.
- **Removed or renamed symbols** — the addition hunk names the replacement. Make sure the map learned the new name; the guard test fails if a symbol leaves `index.js` without the map following.
- **Whole-widget scope** — with no tag at all, everything is in scope. The user can still narrow it.

Say the scope out loud before working (which areas are in, which are out). The user can widen it.

### Steps 1-4, scoped

- **1. Simplify and generalize logic where applicable** — in the in-scope areas only. Consolidate duplication toward the code's single sources of truth; generalize only where it removes real duplication — never restructure for its own sake. Prefer smaller obviously-correct code over clever.
- **2. Refactor where appropriate** — in the in-scope areas only. Load that area's domain skill BEFORE touching its code and follow it as the authoritative spec. If the refactor reaches into an area that was out of scope, load that area's skill at that moment and treat it as in scope from then on. Never violate the AGENTS.md invariants that always hold: gaps used in BOTH renderers and `listHeightBudget` stay in sync; every size/measurement stays a named constant; `FAMILY_LAYOUTS` keeps one `amount` size for the three money rows; taps never leave Scriptable and only a presented tap page calls `App.close()`; the small widget's single tap target is Budget. Security Rules never change: never ask for or access a user API key; API data flows through the Mock API only.
- **3. Add or update code comments** — for the changed code, and for comments in the in-scope areas that the change made stale. Document intent, not history; remove what became stale.
- **4. Verify identical functionality** — always the global floor: `node --check index.js` and the full `node --test test/*.test.js` suite (the suite is the cross-area regression net, and the pre-commit hook runs it anyway). Then verify each in-scope area by its own rules (table below). Out-of-scope areas need no separate verification — the suite covers them — but do verify any out-of-scope area the change could plausibly affect.

  | Area | Verify |
  |---|---|
  | Leftover math | the mock-API relative invariants (never fixed numbers): outflow rows + uncategorized buckets = total outflow; leftover = inflow − outflow; inflow = per-category max income + rollover; a group and its children never both count |
  | Period math | the current and previous periods resolve to the expected range, and the API's occurrence reconciliation still corrects a misaligned seed |
  | Layout & render | the pinned fit matrix and fitted row counts (the suite covers them); every family renders with the badge line up and down, in the current and the previous period |
  | Tap routing & URLs | every target's URL shape (the suite's golden URLs) and the tap branches (page tap, update tap, url-less fallback) |
  | Update check | the check reads tags (not releases), the version comparison, the throttle/cache, the download-and-copy path and its fallback |
  | Data layer & storage | the cache and stale-fallback behavior, that a failed fetch caches nothing, that a failed side-list pull keeps the previous value with its original timestamp, and that the storage sweep keeps the files it must |
  | Tests | the suite passes, and the changed area's cases actually cover the change (new behavior needs a new case; a changed URL shape needs its golden updated) |

  The runnable commands are in `tools/release-scope.areas.json` (each area's `verify` list) and are printed by the scope tool:

  | Tool | What it does |
  |---|---|
  | `node tools/release-scope.mjs` | the scope report for the changes since the last tag |
  | `node tools/boot-harness.mjs` | boots the real `index.js` against Scriptable stubs: every family × current/previous × pending/clean renders, the tap branches, the key-less setup state |
  | `node tools/verify-mock.mjs` | the leftover math against the Mock API's relative invariants |
  | `node tools/check-update.mjs` | the live update check: the newest published tag and the notice for each installed version |
  | `node tools/check-release.mjs` | release hygiene: `SCRIPT_VERSION`, the README link, the CHANGELOG entries, and whether the tag is on the remote |

  On-device verification via Scriptable is still required for visual/layout confirmation.

### Step 5 — Update CHANGELOG.md (global)

- Reconcile first: every existing `refs/tags/vN` must have a `## vN — YYYY-MM-DD` heading. If the user tagged a release manually (outside this workflow), the changelog drifted — add the missing entry retroactively before the new one. The pre-commit hook enforces this: an unsynced tag blocks the next commit, so reconcile in this step rather than stalling a later commit.
- Add the release entry describing user-visible changes since the last `refs/tags/vN` — every user-visible change, whether or not its area was in the pass scope. Follow the file's existing wording style and conventional prefixes.

## Establish the baseline

When verification passes:

- Commit the finalized changes with a conventional prefix per Git Workflow (write concise messages; never push). The CHANGELOG entry travels with the release commit.
- ONLY if this finalize is creating a NEW tag (a release bump): move every
  reference to the PREVIOUS release tag up to the new one. Grep the whole repo
  for the old tag name (e.g. `v5`); the surviving spot at release time is
  usually `README.md`'s raw install link (`.../refs/tags/vN/index.js`). Update
  each hit, commit with a `docs:` prefix, and if that commit lands after the
  tag was created, move the tag to the new HEAD so the baseline is the final
  commit. Never push. If the finalize is a code pass WITHOUT a new tag (no
  version bump), skip this step entirely — pointing references at a tag that
  doesn't exist would break the install link. "Without a new tag" only narrows
  this reference-moving step; it never authorizes skipping steps 1-4.
- Confirm the baseline marker with the user (e.g. the release version/tag name — the repo uses `refs/tags/vN` releases); create the tag locally as the baseline. Never push.
- Before creating the tag, run the hygiene check — it fails if `SCRIPT_VERSION`, the README link, or the CHANGELOG entry disagree with the candidate tag:

  ```sh
  node tools/check-release.mjs --tag vN
  ```

- Report the final message and tag clearly as the baseline in your response.
