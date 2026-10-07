---
name: tap-navigation
description: Use when working with widget tap and deep-link routing in index.js — resolveTap, tappedTarget, presentWebPage, appDeepLink, cameFromTap, fallbackTapUrl, tapShowsPreviousPeriod, transactionPageUrl, budgetTapUrl, deletePendingTapUrl, widget.url targets, or the lock-screen accessory tap fallback.
---

# Tap Navigation

Tap/deep-link routing spec for the widget. Apply these rules before touching `resolveTap`, `tappedTarget`, `presentWebPage`, or any tap URL. All URL facts are webapp-verified, not guessed.

## How a tap is handled

Tap URLs target the Lunch Money web app (`https://my.lunchmoney.app`), then reroute through Scriptable via `appDeepLink`, which wraps each target in `scriptable:///run?scriptName=<this script>&url=<target url>`. The tap is picked up by `resolveTap()` → `tappedTarget()` and `presentWebPage()` in the SETUP section at the top of `index.js`:

- `resolveTap()` waits one tick (Scriptable can inject URL-scheme arguments a beat after a cold start, and treating a tap as a boot would close the app out from under the user; the tick is a native `Timer` — Scriptable's bare-JavaScriptCore runtime has no `setTimeout` global) then calls `tappedTarget()`, which reads the URL from `args.queryParameters.url` (URL-scheme arguments arrive there, not in `args.shortcutParameter`, which is Shortcuts-only).
- `presentWebPage()` loads the target into a Scriptable `WebView` that stays on screen until dismissed — taps never leave Scriptable. It presents full-screen (`present(true)`, not the non-fullscreen default sheet, so a cold-launch transition can't dismiss the page out from under the user), kicks off the load without awaiting it up front, and falls back to `Safari.open` if the presentation fails.
- A tap's only job is to show that page: after the WebView closes the script ends there. The boot sequence (API key, widget render, `setWidget`) runs only for non-tap runs (widget renders, in-app previews, the API-key setup prompt).
- A tap whose `?url=` argument is lost in transit (still a URL-scheme launch, but no http(s) target) opens the plain transactions view instead of booting.
- Only a presented tap page calls `App.close()` — Scriptable's undocumented return-to-home-screen — and only after the user dismisses it (`present()` resolves on dismissal); the boot path never closes the app, so a cold-started tap whose arguments arrived late or not at all can't get sent straight home.
- `resolveTap()` short-circuits widget renders (`config.runsInWidget`) before the wait tick.

## Period encoding

Every target encodes the displayed period (via the period start date and a `time=custom` range), so taps open the same period the widget shows (the previous period when the `previous` parameter is set, the current period otherwise) — EXCEPT the Delete Pending label, whose target intentionally drops the date filter and shows all `status=delete pending` transactions (`time=all`) regardless of period. Targets are set on stacks so each region deep-links where it should; the widget-wide url is the fallback (the regular transactions view everywhere else, Budget on the stacked small widget and the leftover-only lock-screen accessories — the circular ring and the inline strip).

## Target map

### Budget (Inflow / Outflow / Leftover)

Tapping Inflow / Outflow / Leftover opens Lunch Money's budget section for the period. Budget deep-links by period start date: a monthly period anchors on the year/month (`https://my.lunchmoney.app/budget/YYYY/MM/`), and a custom period that doesn't start on the 1st adds its start day (`https://my.lunchmoney.app/budget/YYYY/MM/DD`). The small (stacked) widget and the extraLarge breakdown use this budget target too. On the small widget it is the widget's SINGLE tap target: Scriptable only honors element urls (stacks/text) in medium and large widgets — a small widget opens whatever `widget.url` holds no matter where it is tapped — so the delete-pending label and the metrics never carry their own urls there (they would be dead), and the whole small widget opens Budget.

### Unreviewed list

Tapping the unreviewed transactions list opens transactions filtered by unreviewed + pending for the period (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&match=all&start_date=YYYY-MM-DD&status=unreviewed&include_pending=true&time=custom`)

### Delete Pending label

When synced transactions await a manual delete, a LOSS_RED "Deleted Transactions Pending" label (same size/style as the metric captions — the rectangular accessory instead uses the standard label color brandYellow, keeping the lock screen's "labels one color, amounts another" rule) shows once in the unreviewed list column, on top above the "Unreviewed Transactions" caption. The small stacked widget (no unreviewed list) tops its metrics with the same badge line instead — there it is DISPLAY-ONLY, because a small widget's single tap target (Budget, via `widget.url`) covers the whole widget, so per-element urls never fire; the label still reads as the alert it is. The label aligns like the caption it mirrors: centered on the large widget, left-aligned on the medium. Tapping it opens ALL transactions filtered to `status=delete_pending` with NO date filter (`https://my.lunchmoney.app/transactions?match=all&status=delete pending&time=all`) — manual deletes are period-independent, so unlike every other target it skips the period path and `time=custom` range regardless of the period set on the widget it was clicked in (`deletePendingTapUrl` builds `/transactions` directly instead of going through `transactionPageUrl`). Two webapp facts drive that URL shape: the transactions page only honors the status filter label with a space (`status=delete pending` — the API's underscored `delete_pending` matches nothing, so the tap would land on the plain list), and `time=all` is how the webapp expresses "all time" (its date-range helper returns no range for it). The count comes from a parallel `/transactions?status=delete_pending` request in `lunchMoneyLeftoverInfo` (`fetchDeletePendingTransactions`); the label renders only when the count is nonzero, and a failed fetch degrades to no label. The label is never placed inside a stack that already carries a tap URL: its parent column has NO url of its own (the unreviewed url lives on the caption row and the list stack only), because a parent stack's url can shadow a child label's url and misroute the tap.

### Fallback

Tapping anywhere else opens the regular transactions list for the period, including pending transactions (`https://my.lunchmoney.app/transactions/YYYY/MM?end_date=YYYY-MM-DD&include_pending=true&start_date=YYYY-MM-DD&time=custom`)

## Lock-screen accessory widgets

`widget.url` is set best-effort for all families including accessories (accessoryCircular / accessoryRectangular / accessoryInline) — the transactions fallback (`transactionsTapUrl(data)`) everywhere except the leftover-only layouts, the small circular ring (`accessoryCircular`) and the inline strip (`accessoryInline`), which carry `budgetTapUrl(data)` just like the stacked small widget. Scriptable is documented as ignoring `.url` on lock-screen families; if it honors it on a given iOS version, accessory taps work automatically with zero user configuration. When it doesn't, the manual per-widget "When Interacting: Open URL" path remains as a fallback: the user pastes a `scriptable:///run?scriptName=<name>` deep-link (with an optional `&parameter=previous` to match the widget's period).

That tap arrives url-less — `tappedTarget()` returns `""`, `cameFromTap()` triggers `fallbackTapUrl()`, which fetches `/budgets/settings` (one request), derives the displayed period via `tapShowsPreviousPeriod()`, and returns `transactionsTapUrl({ periodStart, periodEnd })` — the same target the non-leftover families' `widget.url` carries for home screens. If the API key is missing or the settings fetch fails, it degrades to the plain `WEB_APP_URL + "/transactions"` rather than booting.

`tapShowsPreviousPeriod()` reads the period flag in order: `args.queryParameters.parameter` (from the configured deep-link), then `args.widgetParameter` (normally empty for lock-screen taps), defaulting to current.

## Node verification

The tap-URL builders (`periodPathParts` … `transactionsTapUrl`) don't depend on Scriptable globals, so they can be extracted and run in plain Node — and they already are. `test/pure-core.test.js` slices this region out of `index.js` by marker and pins every builder's URL as a hardcoded golden string under `describe('tap URL builders (golden)')` (the `scriptable:///run?scriptName=<name>&url=<encodeURIComponent(target)>` envelope, `delete pending`'s encoding, and the no-period fallbacks). Any deliberate change to a target's shape must update its golden in the same change; run `node --test test/*.test.js`. The harness slices `index.js` by function-signature markers; keep the boundary comments and signatures intact (they are the slice anchors).