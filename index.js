/*******************************************************************************
 *                                                                             *
 *   LUNCH MONEY WIDGET — a Scriptable home-screen widget.                     *
 *                                                                             *
 *   Pulls the current budget period’s totals and unreviewed transactions      *
 *   or, with the “previous” widget parameter, the prior period — from the     *
 *   Lunch Money API, computes the period leftover, and renders it as a        *
 *   family-specific layout (small / medium / large / extraLarge, plus the     *
 *   lock-screen accessory rectangular / circular / inline widgets).           *
 *                                                                             *
 *   Layout rules of the road:                                                 *
 *     - Every size/measurement used to lay anything out is a named constant   *
 *       up front, so tweaks stay in one place and translate to Scriptable's   *
 *       point-based coordinates.                                              *
 *     - Row budgets are derived from the device's real widget container size  *
 *       (see widgetSizes) so lists never overflow the bottom edge.            *
 *     - The METRICS table is the single source for what each money row        *
 *       shows (label, value, color); layouts only choose order and size.      *
 *     - Tap targets deep-link to the Lunch Money web app at the displayed     *
 *       period (see AGENTS.md → Tap Navigation) and are shown inside          *
 *       Scriptable in a WebView — never exported to the browser. Per-region   *
 *       targets live on stacks; the widget-wide url is the fallback (the      *
 *       transactions view — except the single-target widgets: the stacked     *
 *       small widget and the leftover-only accessories (circular + inline)    *
 *       open Budget, exactly like the small home-screen widget).              *
 *     - When synced transactions await a manual delete (delete_pending), a    *
 *       red "Deleted Transactions Pending" label tops the unreviewed column   *
 *       above the "Unreviewed Transactions" caption, aligned like it          *
 *       (centered on large, left on medium) at the cost of the list's last    *
 *       fitted row while it's up; the small stacked widget (no list) tops its *
 *       metrics with the same line. Manual deletes are period-independent, so *
 *       the label counts ANY delete_pending transaction in the account (not   *
 *       just the displayed period); tapping opens the same UNFILTERED page.   *
 *       The same line doubles as the widget's update notice — only when NO    *
 *       deletes are pending and a newer release exists does it read green     *
 *       "Update Available!"; tapping it copies the new index.js to the clip-  *
 *       board and reopens this script in the editor to paste it (the widget   *
 *       has no updater of its own).                                           *
 *                                                                             *
 ******************************************************************************/

/****************************************************
             SECTION INDEX
******************************************************
 * Search for these banner headings to jump between the file's regions.        *
 *   CONFIGURATION              constants: fonts, colors, metrics, API, cache  *
 *   SETUP                      tap routing, boot sequence, widget rendering   *
 *   DATA LAYER - API + cache   requests, caching, data assembly               *
 *   LEFTOVER CALCULATION       computeLeftover and its helpers                *
 *   UTILITIES - formatting + calendar   money/date formatting, period math    *
 *   STORAGE                    on-disk cache + stray-file sweep               *
 *   WIDGET LAYOUTS             per-family renderers, row-fit math             *
 *   UI PRIMITIVES              shared addTextRow and friends                  *
 *                                                                             *
 * The pure functions (LEFTOVER CALCULATION, UTILITIES, and the tap-URL        *
 * builders in CONFIGURATION) are covered by test/pure-core.test.js, which    *
 * extracts this file by marker and evaluates the regions in plain Node —     *
 * keep the function signatures and their boundary comments intact.           *
 ******************************************************************************/

/****************************************************
             CONFIGURATION
*****************************************************/

// Widget background: two-stop top-to-bottom gradient (subtle depth)
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E'
};

// Brand palette. Roles:
//   BRAND_GREEN — positive figures + the product title
//   BRAND_YELLOW — captions / section labels
//   LOSS_RED    — a negative leftover / the Delete Pending badge
//   UPDATE_GREEN — the Update Available badge (LOSS_RED's counterpart: the same
//                  muted saturation/lightness, hue mirrored across the wheel)
const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';
const UPDATE_GREEN = '#55A85E';

// Typography follows the Lunch Money style guide: Avenir for titles and
// labels, and a pre-installed monospace (Menlo) for every monetary figure
// and transaction name. The monospace digits share one advance width —
// which is what makes amounts right-adjust and line up. White is the
// default text color.
const FONT_NAME = "Avenir";
const FONT_BOLD = "Avenir-Heavy";
const MONO_FONT_NAME = "Menlo";
const MONO_FONT_BOLD = "Menlo-Bold";
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

// Reusable color objects so layout helpers don't rebuild them every frame
const brandGreen = new Color(BRAND_GREEN);
const brandYellow = new Color(BRAND_YELLOW);
const lossRed = new Color(LOSS_RED);
const updateGreen = new Color(UPDATE_GREEN);
// iOS system green / red flag income (+) vs expenses (-) in a transaction row
const incomeGreen = new Color('#34C759');
const expenseRed = new Color('#FF3B30');

// Font factories so every stack shares the same typography
function font(size) { return new Font(FONT_NAME, size); }
function boldFont(size) { return new Font(FONT_BOLD, size); }
function monoFont(size) { return new Font(MONO_FONT_NAME, size); }
function monoBoldFont(size) { return new Font(MONO_FONT_BOLD, size); }

// Monospace (Menlo) advance width ≈ 0.6em per glyph. A named constant so that
// every width estimate (charWidth → textWidth → the payee/amount budgets)
// derives from a single source.
const MONO_GLYPH_WIDTH = 0.6;

// "@ H:MM AM/PM" from a timestamp
function formatUpdateTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const h = d.getHours() % 12 || 12;
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  return `@ ${h}:${mm} ${ampm}`;
}

// --------------------------------------------------------------------------
// Money metrics. Single table of the three money rows every layout renders;
// each row knows how to label itself and pull its value from loaded data.
//   - inflow / outflow stay white (fixed color)
//   - leftover is sign-colored: green when positive, red when negative
// Layouts pick their own display ORDER and per-metric sizes; this table only
// guarantees the same value and style logic everywhere.
// --------------------------------------------------------------------------
// The leftover row's display label, shared by the METRICS table and every
// place that titles the leftover figure (error state, breakdown, accessories)
// so the wording can't drift between them.
const LEFTOVER_LABEL = "Leftover";
const METRICS = [
  { id: "inflow",   label: "Inflow",       value: (d) => Math.abs(d.inflow), color: regularColor },
  { id: "outflow",  label: "Outflow",      value: (d) => d.outflow,          color: regularColor },
  { id: "leftover", label: LEFTOVER_LABEL, value: (d) => d.savings,          color: undefined }
];
function getMetric(id) { return METRICS.find((m) => m.id === id); }

// The overview layout renders the three money rows as three equal columns in
// this order — Leftover sits between Inflow and Outflow, unlike METRICS.
const OVERVIEW_METRIC_ORDER = ["inflow", "leftover", "outflow"];

// Widest monetary strings the layout budgets around: the 10-char figure every
// amount pads/right-justifies to, and the signed worst case a transaction row
// reserves next to its payee. DECLARED UP HERE because (a) the small layout's
// amount font derives from MAX_MONEY's width, and (b) the payee budget for the
// medium list needs the signed worst case. (formatMoney is a hoisted function,
// so calling it during module init is fine.)
const MAX_MONEY = formatMoney(99999);
const MAX_SIGNED_MONEY = "+$999,999.99";

// --------------------------------------------------------------------------
// Lunch Money API
// --------------------------------------------------------------------------
const BASE_URL = 'https://api.lunchmoney.dev/v2';

// Scriptable's Request defaults to a 60-second idle timeout — far longer than
// WidgetKit lets a widget run. Cap each call so an unresponsive API fails fast
// and the callers fall back to the stale cache (getAllData) instead of the
// widget being killed with "Timeout while running script".
const REQUEST_TIMEOUT = 10; // seconds

// Tap targets (web versions of the Lunch Money app deep links): the widget-wide
// default opens the transactions list; the metrics and unreviewed regions
// override it with their own targets. Budget deep-links by the displayed
// period's start date, and the transactions views pin the same period — the
// year/month path alone when the period IS its whole calendar month (which
// also keeps the webapp's quick search bar visible), a time=custom range
// otherwise — and include pending transactions.
const WEB_APP_URL = "https://my.lunchmoney.app";

// Period path segments (year, two-digit month, and zero-padded start day)
// from the displayed period; empty until data loads
function periodPathParts(data) {
  const start = data && data.periodStart ? parseIsoDate(data.periodStart) : null;
  if (!start || isNaN(start)) return { year: "", month: "", day: "00" };
  return {
    year: String(start.getFullYear()),
    month: String(start.getMonth() + 1).padStart(2, "0"),
    day: String(start.getDate()).padStart(2, "0")
  };
}

// Period filter query the web app uses to pin a custom time range
function periodParams(data) {
  return (data && data.periodStart && data.periodEnd)
    ? { end_date: data.periodEnd, start_date: data.periodStart, time: "custom" }
    : {};
}

// True when the period spans exactly its start's calendar month (1st → last
// day), so the /transactions/YYYY/MM path pins it without a query range.
// Webapp-verified: start_date/end_date are ignored unless time=custom
// accompanies them, and any time=custom range (like any status/match filter)
// swaps the quick search bar out of the transactions toolbar — so full-month
// periods drop the range and keep quick search on tap, while custom periods
// keep their exact range and open without the bar (no URL shape does both).
function periodIsFullMonth(data) {
  if (!data || !data.periodStart || !data.periodEnd) return false;
  const start = parseIsoDate(data.periodStart);
  const end = parseIsoDate(data.periodEnd);
  if (isNaN(start) || isNaN(end)) return false;
  return start.getDate() === 1 &&
    end.getTime() === lastDayOfMonth(start.getFullYear(), start.getMonth()).getTime();
}

// Tapping inflows/outflows/leftover opens the Budget page for the period.
// Budget deep-links by the period start date: a monthly period anchors on the
// year/month path, a custom period (not starting on the 1st) adds its start day.
function budgetTapUrl(data) {
  const p = periodPathParts(data);
  if (!p.year) return appDeepLink(WEB_APP_URL + "/budget");
  return appDeepLink(p.day === "01"
    ? `${WEB_APP_URL}/budget/${p.year}/${p.month}/`
    : `${WEB_APP_URL}/budget/${p.year}/${p.month}/${p.day}`);
}

// Shared builder: /transactions/YYYY/MM pinned to the displayed period — a
// full calendar month rides the path alone, only a custom period pays for the
// time=custom range (and, with it, the quick search bar)
function transactionPageUrl(data, filters) {
  const p = periodPathParts(data);
  const path = p.year ? `/transactions/${p.year}/${p.month}` : "/transactions";
  const period = periodIsFullMonth(data) ? {} : periodParams(data);
  return appDeepLink(WEB_APP_URL + path + buildQueryString({ ...period, ...filters }));
}

// Reroutes a Lunch Money tap back into Scriptable: the target web-app URL is
// wrapped in a scriptable:///run deep-link that runs this same script (under
// its own name) with the target as the ?url= query parameter. The SETUP block
// below then presents it in a Scriptable WebView instead of the browser.
function appDeepLink(url) {
  return `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&url=${encodeURIComponent(url)}`;
}

// The unreviewed list opens transactions filtered by unreviewed + pending
function unreviewedTapUrl(data) {
  return transactionPageUrl(data, { status: "unreviewed", include_pending: true, match: "all" });
}

// The Delete Pending badge opens every transaction still waiting on a manual
// delete — all of them, with NO date filter. Missed manual deletes are
// period-independent, so the target skips the period path and the time=custom
// range only a custom period pins; time=all is how the web app expresses
// "all time" (buildQueryDateRange returns no date range for it). The status
// value is the web app's own filter label, "delete pending" (a space, not the
// API's delete_pending — the transactions page matches the label literally,
// so the underscore value would match nothing and land on the plain list).
function deletePendingTapUrl() {
  return appDeepLink(WEB_APP_URL + "/transactions" + buildQueryString({
    match: "all",
    status: "delete pending",
    time: "all"
  }));
}

// Any other tap opens the regular transactions view, pending included
function transactionsTapUrl(data) {
  return transactionPageUrl(data, { include_pending: true });
}

// The update line's tap target: a scriptable:///run deep-link carrying the
// record's updateTag as the ?update= parameter (NOT ?url=, so tappedTarget()
// doesn't treat it as a web page). The SETUP tap branch reads it back and runs
// the copy-the-new-script flow instead of presenting a WebView. Like appDeepLink
// it names this script so a widget tap relaunches it.
function updateTapUrl(data) {
  return `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&update=${encodeURIComponent(data.updateTag)}`;
}

// Field of the /summary totals breakdown that feeds the outflow side of the
// leftover. Outflow only sums the uncategorized buckets: transactions with no
// category never appear in a category row, so they'd otherwise be counted as
// neither inflow nor outflow. Every other outflow field already shows up in a
// budgeted or unbudgeted category's contribution. Inflow comes from the income
// categories instead (see incomeInflow), not from this breakdown.
// (DECLARED UP HERE so they initialize before the boot sequence awaits — the
// calc functions reference them, and top-level await below would otherwise
// read them from the temporal dead zone.)
const OUTFLOW_FIELDS = ["uncategorized", "uncategorized_recurring"];

// --------------------------------------------------------------------------
// Local storage
// --------------------------------------------------------------------------
// Scriptable widget parameter selects which budget period to show: "previous"
// displays the period before the current one, anything else (or nothing)
// defaults to the current period. Case-insensitive, whitespace trimmed.
const WIDGET_PARAMETER = String(args.widgetParameter || "").trim().toLowerCase();
const SHOW_PREVIOUS_PERIOD = WIDGET_PARAMETER === "previous";

// BASE_FILE: folder (under Scriptable's Documents dir) for the cache;
// API_KEY: the Keychain entry holding the API token;
// CACHE_KEY + CACHED_MS: cache file name and how long a fresh copy stays usable.
// The cache is split by period so a "previous" request never serves the current
// period's cached data (or vice versa).
const BASE_FILE = 'LunchMoneyWidget';
const API_KEY = "lunchMoneyApiKey";
// The two period cache files. CACHE_KEY is the one this run reads/writes; the
// sweep in STORAGE keeps BOTH, so a "current" run never deletes the "previous"
// cache (or vice versa).
const CURRENT_CACHE_KEY = "lunchMoneyCache";
const PREVIOUS_CACHE_KEY = "lunchMoneyCache_previous";
const CACHE_FILE_NAMES = [CURRENT_CACHE_KEY, PREVIOUS_CACHE_KEY];
const CACHE_KEY = SHOW_PREVIOUS_PERIOD ? PREVIOUS_CACHE_KEY : CURRENT_CACHE_KEY;
const CACHED_MS = 600000; // 10 minutes
// The update-check record file (see fetchUpdateInfo); kept outside the per-period
// cache files so a period run's cache never clobbers the shared check result.
const UPDATE_CHECK_KEY = "lunchMoneyUpdateCheck";

// Update notice. The widget has no updater of its own — this only surfaces a
// new release in the shared top-of-list line (BADGE_UPDATE_LABEL), whose tap
// copies the new script and opens the editor for a manual paste (the project's
// distribution model). SCRIPT_VERSION must be bumped on every release to match
// the pushed tag; UPDATE_CHECK_MS throttles the check to once a day.
const SCRIPT_VERSION = "v12";
const UPDATE_REPO = "john-cabaj/leftover-lunch-money";
const UPDATE_CHECK_MS = 86400000; // 24 hours

// v2 renamed "uncleared" to "unreviewed"; match either so accounts mid-migration work
const UNREVIEWED_STATUSES = ["unreviewed", "uncleared"];

// Month names for the header label
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// --------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------

// Real rendered line heights read from Scriptable's font metrics, so row
// budgets match how text actually lays out; a budget that under-measures lets a
// full list overflow, and Scriptable pushes the excess off the TOP of the
// widget — clipping the LUNCH MONEY title. The fallback factors keep this
// working on runtimes without Font.lineHeight. LINE_HEIGHT_FACTOR (≈1.15×) is
// Menlo's tight line box, used by the small widget's amount fit.
const LINE_HEIGHT_FACTOR = 1.15;              // Menlo height factor (small-widget fit)
const AVENIR_LINE_HEIGHT_FALLBACK = 1.35;    // Avenir's tall line box, no Font.lineHeight
function measureLineHeight(size, name, fallback) {
  const f = new Font(name, size);
  const lh = f.lineHeight;
  return Math.ceil(typeof lh === "number" && lh > 0 ? lh : size * fallback);
}
// Avenir text (titles, captions, period, detail rows, the Delete Pending label)
function lineHeight(size) { return measureLineHeight(size, FONT_NAME, AVENIR_LINE_HEIGHT_FALLBACK); }
// Menlo-Bold money figures (the three amount rows)
function monoLineHeight(size) { return measureLineHeight(size, MONO_FONT_BOLD, LINE_HEIGHT_FACTOR); }
// Menlo regular, the unreviewed rows' font: the amounts are Menlo-Bold (held by
// monoLineHeight), so each pitch is measured with the exact font it renders.
// The pair usually shares metrics, but measuring the real font is the only way
// a row pitch can never drift from its render.
function monoRegularLineHeight(size) { return measureLineHeight(size, MONO_FONT_NAME, LINE_HEIGHT_FACTOR); }

// The Lean line box (LEAN_LINE_FACTOR) is used ONLY where the widget reserves
// fixed header/caption space that WidgetKit renders tighter than Font.lineHeight
// (the visible slack on device): the medium review layout's header + caption and
// the Delete Pending badge line. The small stacked widget's badge line shares
// that lean reserve: it tops the metrics (addStackedMetrics) and the extra line
// is absorbed by the same slack — WidgetKit lays the Avenir caption lines tighter
// than the measured lineHeight the amount fit reserves against, so the label
// needs no size or padding change and no height is searched for.
const LEAN_LINE_FACTOR = 1.06;
function leanLineHeight(size) { return Math.ceil(size * LEAN_LINE_FACTOR); }

// Widget container sizes (pt): [width, small, medium, large] for the widget
// families by device screen (portrait points). Read from Device.screenSize() so
// widths and row budgets scale to whatever iPhone this runs on; values follow
// Apple's widget HIG. Phones whose heights resolve to the same sizes share one
// array, and unknown heights fall back to the X-class (329x155) family.
function widgetSizes() {
  const h = Math.max(Device.screenSize().width, Device.screenSize().height);
  const MAX  = [364, 170, 170, 382]; // 14/15/16 Pro Max, 13 Pro Max (932 / 428x926)
  const LG   = [360, 169, 169, 379]; // 11, XR, XS Max, 11 Pro Max (896)
  const PRO  = [338, 158, 158, 354]; // 16 Pro, 15 Pro/15, 12/13/14 (Pro) (874/852/844)
  const MODERN = [329, 155, 155, 345]; // X, XS, 11 Pro, 12/13 mini, 360x780 compact (812/780)
  const PLUS = [348, 159, 157, 357]; // 7/8 Plus (736)
  const SE   = [321, 148, 148, 324]; // 7/8, SE 2nd/3rd gen (667)
  const SE1  = [292, 141, 141, 311]; // SE 1st gen (568)
  const SPEC = ({
    932: MAX, 926: MAX,
    896: LG,
    874: PRO, 852: PRO, 844: PRO,
    812: MODERN, 780: MODERN,
    736: PLUS,
    667: SE,
    568: SE1
  })[h] || MODERN;
  return { width: SPEC[0], small: SPEC[1], medium: SPEC[2], large: SPEC[3] };
}

const WIDGET_SIZE = widgetSizes();

// Lock-screen accessory sizes (pt) keyed by the longest device screen side —
// the same keys as widgetSizes, per Apple's HIG for iOS lock-screen widgets.
// Each spec is [rectangularW, rectangularH, circular]; unknown devices (the
// SE 1st gen — no lock-screen widgets — and iPads) fall back to the X-class
// rectangular accessory.
const ACCESSORY_SPECS = {
  932: [172, 76, 76], 926: [172, 76, 76],                       // 14/15/16 Pro Max, 13 Pro Max
  896: [160, 72, 76],                                           // XR, 11, XS Max, 11 Pro Max
  874: [160, 72, 72], 852: [160, 72, 72], 844: [160, 72, 72],   // 16/15/14/13/12 Pro family
  812: [157, 72, 72], 780: [157, 72, 72],                       // X, XS, 11 Pro, 12/13 mini, 360x780
  736: [170, 76, 76],                                           // 7/8 Plus
  667: [153, 68, 68]                                            // 7/8, SE 2nd/3rd gen
};
function accessorySize() {
  const h = Math.max(Device.screenSize().width, Device.screenSize().height);
  const spec = ACCESSORY_SPECS[h] || ACCESSORY_SPECS[812];
  return { rectW: spec[0], rectH: spec[1], circular: spec[2] };
}
const ACCESSORY_SIZE = accessorySize();

// Height budget per layout. review keeps +2pt slack so the last row isn't
// clipped on the taller (~170pt) medium widgets; the rectangular accessory
// budgets against its own device height (a lock-screen element, so the home
// screens' WIDGET_SIZE never applies).
const WIDGET_HEIGHTS = {
  review: WIDGET_SIZE.medium + 2,
  overview: WIDGET_SIZE.large,
  accessoryRectangular: ACCESSORY_SIZE.rectH
};
const PADDING_Y = 28;      // setPadding(14, 10, 14, 10)
const TOP_PAD = 14;        // default top inset; small drops to topPad below
const STACK_SPACING = 2;   // mainStack.spacing
const ROW_GAP = 1;         // trailing gap after each unreviewed row; keep in sync
                           // with rowFitHeight so the list budget matches rendering
const STALE_ROW_OPACITY = 0.5; // opacity of a carried-forward (unrefreshed) row

// Rectangular lock-screen accessory layout: tight margins — lock screen widgets
// use smaller insets than home-screen widgets — plus the gap between the
// Leftover line and the Unreviewed caption. Shared by addAccessoryRectangular
// (where the spacer is rendered) and listHeightBudget (which subtracts the same
// points to fit rows), so a tweak always lands in both places together.
const ACC_PAD_TOP = 4;
const ACC_PAD_BOTTOM = 4;
const ACC_PAD_SIDE = 6;
const ACC_HEADER_GAP = 2;  // accessory: Leftover line → "Unreviewed Transactions" caption
const ACC_SLACK = 2;       // accessory: reserved so the last row never touches the edge

// The Menlo transaction rows sit a hair to the LEFT of the Avenir captions at
// the same leading origin — the two faces render their first glyph at slightly
// different left bearings — so the Menlo rows take a small leading nudge to
// share the caption's visual left edge. Applied to every layout whose list
// sits under a left-aligned caption (see menloInsetLayout): the medium review
// split and the lock-screen rectangular accessory.
// Calibrate on device: larger moves the Menlo text further right, negative
// flips the direction.
const MENLO_LEFT_INSET = 1;

// Gaps the render inserts between the header and the body, and inside the
// overview body. Shared by BOTH renderWidget/addOverview (where the spacer is
// rendered) and listHeightBudget (which subtracts the same points to fit list
// rows), so a gap tweak always lands in both places together.
const REVIEW_GAP = 0;      // review: header → metrics/list split; medium's headerPad
                           // (6pt) plus this gap stays at 6pt so row counts don't change
const OVERVIEW_GAP = 6;    // overview + extraLarge: header → body
const LIST_BODY_GAP = 10;  // overview: metric row → "Unreviewed Transactions" caption
const TITLE_TIME_GAP = 4;  // brand title → last-update time on the same line
const INLINE_GAP = 8;      // gap between a row's left label and its right value
const METRIC_LIST_GAP = 24; // review: metrics column → unreviewed list

// Sizes of the two header rows (LUNCH MONEY title and the period label beneath
// it); headerBlockHeight reserves exactly their combined height. The title and
// period sit in one nested stack whose gap defaults to STACK_SPACING and can be
// tightened per layout (medium sets headerGap 0 so the title sits closer to the
// period). The title renders with boldFont(TITLE_SIZE), the period with
// font(PERIOD_SIZE).
const TITLE_SIZE = 12;
// The Delete Pending badge's label text (all synced transactions awaiting a
// manual delete), styled and phrased like the "Unreviewed Transactions" caption
// (plural "Transactions"): one caption-weighted line in the palette's loss red
// shown above the caption at the top of the unreviewed list column. The small
// stacked widget (no unreviewed list) tops its metrics with the same line
// (addStackedMetrics).
const BADGE_PENDING_LABEL = "Deleted Transactions Pending!";
// The Delete Pending line doubles as the update notice: when the account has
// NO delete_pending transactions but a newer release exists, the same top-of-
// list line reads "Update Available!" (in UPDATE_GREEN); tapping it copies the
// new script to the clipboard and opens the editor. Pending transactions always
// win the single line.
const BADGE_UPDATE_LABEL = "Update Available!";
const PERIOD_SIZE = 11;
function headerBlockGap(config) {
  return pad(config, "headerGap", STACK_SPACING);
}

// Resolves a per-layout config value, falling back when the layout doesn't set
// it (or is absent). Used for the accessory margins (each lock-screen family
// only lists the insets it actually customizes) and the header gap.
function pad(config, key, fallback) {
  return config && config[key] != null ? config[key] : fallback;
}

function headerBlockHeight(config, measure = lineHeight) {
  return measure(TITLE_SIZE) + headerBlockGap(config) + measure(PERIOD_SIZE);
}

// Total vertical space a layout's header occupies: the fixed header block height
// plus any per-layout headerPad pushed in above the title. The pad doesn't push
// the body down (the trailing flexible spacer absorbs it), but the row budgets
// still account for it so list rows never cross the widget's bottom edge. The
// Delete Pending badge lives in the unreviewed list column, not the header, so
// it is reserved by listHeightBudget instead (deletePendingBadgeHeight).
// measure is the line box the height is budgeted at: the full Avenir box by
// default, the lean box where a budget reserves WidgetKit's tighter rendering
// (the review list budget).
function headerHeight(config, measure = lineHeight) {
  return headerBlockHeight(config, measure) + (config.headerPad || 0);
}

// Vertical space the top-of-list badge occupies at the top of the
// unreviewed list column: one caption-weighted line above the caption, plus
// LIST_BOTTOM_SLACK breathing room so the list never sits flush against the
// widget's height limit while the badge is up (a flush list can clip the top
// of the widget, and the review layout already builds the same 2pt slack into
// WIDGET_HEIGHTS). Only layouts that render an unreviewed list under a caption
// reserve it (review / overview / accessoryRectangular — the rectangular
// lock-screen accessory, whose list fits by the same budget); the small stacked
// widget's badge line sits in the widget's on-device slack above the metrics
// instead and reserves nothing, and layouts without an unreviewed list never
// show the badge. The badge shows for EITHER message (hasBadgeLine: pending
// deletes or, when none, an available update), so the fitted row counts shrink
// whenever that one line is up — whichever of the two it is.
// The badge line itself is reserved at the LEAN box (like the review header and
// caption): WidgetKit layers text tighter than Font.lineHeight, so reserving
// the full measured line under-couns and wastes part of a row while the badge
// is up. Nothing about the badge's own fit is at risk — the label is short,
// one line, and never near the width edge or the top clip zone.
const LIST_BOTTOM_SLACK = 2; // guaranteed gap under the last row / badge line
function deletePendingBadgeHeight(data, config) {
  if (!config || !hasBadgeLine(data)) return 0;
  if (config.layout !== "review" && config.layout !== "overview" && config.layout !== "accessoryRectangular") return 0;
  return leanLineHeight(config.caption) + LIST_BOTTOM_SLACK;
}

// True when the shared top-of-list line renders either message: pending delete
// transactions OR, only when there are none, an available update. Pending wins
// the single line, so an available update never hides a delete warning.
function hasBadgeLine(data) {
  return hasDeletePending(data) || hasUpdate(data);
}

// True when synced transactions await a manual delete (the Delete Pending
// badge's trigger); a failed fetch sets a zero count and degrades to no badge.
function hasDeletePending(data) {
  return !!data && (data.deletePendingCount || 0) > 0;
}

// Inner content width: container width minus the 10pt side padding on each
// edge. Shared by the small amount sizing and the medium review split.
const WIDGET_INNER_WIDTH = WIDGET_SIZE.width - 20;

// Medium review split: the metrics column keeps the smaller share so the
// unreviewed list gets the rest (31% / 69% of the inner width). The two
// weights are Scriptable layoutWeight units that sum to 100.
const METRICS_WEIGHT = 31;
const LIST_WEIGHT = 69;

// The unreviewed list column's width: its share of the inner width (the medium
// widget's inner width is WIDGET_INNER_WIDTH). Used when capping payee lengths
// so a name never runs into its amount.
const LIST_COLUMN_WIDTH = (WIDGET_INNER_WIDTH * LIST_WEIGHT) / (METRICS_WEIGHT + LIST_WEIGHT);

// --------------------------------------------------------------------------
// Per-widget-family styling
// --------------------------------------------------------------------------

// small and the in-app preview share a layout; the amount font is derived
// rather than fixed: the largest size where MAX_MONEY ("$99,999.00") still
// fits the inner width AND the three caption+amount rows fit the widget height.
const SMALL_CAPTION = 10;
function smallAmountFont() {
  // The limiting size is the smaller of the width bound (widest figure must
  // fit the inner width) and the height bound (three rows must fit below the
  // title and captions)
  const byWidth = Math.floor(WIDGET_INNER_WIDTH / textWidth(MAX_MONEY, 1));
  // Height left for the three amount rows after padding, title, gaps, and the
  // three captions; 2pt slack keeps the final row from clipping.
  const rowBudget = WIDGET_SIZE.small - PADDING_Y - lineHeight(TITLE_SIZE)
    - STACK_SPACING - 3 * lineHeight(SMALL_CAPTION) - 2;
  const byHeight = Math.floor(rowBudget / (3 * LINE_HEIGHT_FACTOR));
  return Math.min(byWidth, byHeight);
}

const smallLayout = { layout: "stacked", caption: SMALL_CAPTION, amount: smallAmountFont(), topPad: 10 };
const FAMILY_LAYOUTS = {
  small:      smallLayout,
  // medium: a 6pt push-in above the title keeps it clear of the top edge, and
  // headerGap 0 pulls the title down flush against the period label; the reduced
  // review gap compensates so every device keeps its verified row count
  medium:     { layout: "review", caption: 13, amount: 30, detailFont: 11, payeeLen: 28, headerPad: 6, headerGap: 0 },
  large:      { layout: "overview", caption: 14, amount: 30, detailFont: 12, payeeLen: 30 },
  extraLarge: { layout: "breakdown", caption: 15, amount: 46, detailFont: 11 },
  // Lock-screen accessories: no gradient background, no header, tighter margins
  // (each family only lists the insets it overrides; the tap URL is set
  // best-effort on all families in getWidget). The rectangular widget shows the
  // Leftover line + the unreviewed list; the circular one shows a "Leftover"
  // caption above the amount; the inline one shows just the Leftover amount.
  accessoryRectangular: { layout: "accessoryRectangular", caption: 10, amount: 10, detailFont: 9, accessory: true, padTop: ACC_PAD_TOP, padBottom: ACC_PAD_BOTTOM, padSide: ACC_PAD_SIDE },
  accessoryCircular: { layout: "accessoryCircular", caption: 9, amount: 13, accessory: true, padTop: 0, padBottom: 0, padSide: 0 },
  accessoryInline: { layout: "accessoryInline", accessory: true, padTop: 0, padBottom: 0, padSide: 8 },
  undefined:  smallLayout
};

// Each layout name maps to its body renderer; renderWidget just dispatches on it
// — the same table-driven shape METRICS and FAMILY_LAYOUTS use. Review, overview,
// and breakdown share the header+spacer skeleton (with distinct gaps); the
// stacked small widget and the lock-screen accessories build their own bodies.
// Feel right here in the configuration block (not a later section) because the
// boot sequence at the top of SETUP calls renderWidget via getWidget, and a
// table defined lower in the file would still be in its temporal dead zone then.
const LAYOUT_RENDERERS = {
  stacked(mainStack, data, config) {
    addBrandTitle(mainStack, data, config);
    addStackedMetrics(mainStack, data, config);
  },
  review(mainStack, data, config) {
    withHeaderAndSpacer(mainStack, data, config, REVIEW_GAP, addReviewSplit);
  },
  overview(mainStack, data, config) {
    withHeaderAndSpacer(mainStack, data, config, OVERVIEW_GAP, addOverview);
  },
  breakdown(mainStack, data, config) {
    withHeaderAndSpacer(mainStack, data, config, OVERVIEW_GAP, addBreakdownSection);
  },
  accessoryRectangular: addAccessoryRectangular,
  accessoryCircular: addAccessoryCircular,
  accessoryInline: addAccessoryInline
};

/****************************************************
             SETUP - runs every time the script runs
*****************************************************/

// A widget tap ships a Scriptable deep-link (see appDeepLink) with the target
// as the ?url= query parameter and this script runs in the app to show it in a
// WebView. A tap's only job is to show that page, so after the WebView closes
// the run ends there. A tap that lost its ?url= argument in transit — or a
// lock-screen accessory tap, whose configured "Open URL" can only carry a
// scriptable:///run deep-link — still opens something useful (the same
// transactions view the home-screen fallback opens, period included) rather
// than booting. Widget renders, in-app previews, and the API-key setup prompt
// have no tap target and boot exactly as before. Only a presented tap page
// closes the app (to drop back home after it's dismissed); a boot run that
// leaves the user in the app is fine — and a cold-started tap whose URL
// arguments arrived late or not at all must never close the app out from under
// the user.
// Module-scoped so the data layer (lunchMoneyLeftoverInfo / sendLunchMoneyRequest)
// can read it; assigned in the boot sequence below.
let LM_ACCESS_TOKEN = null;

// The action this run should take after the one-beat cold-start wait:
//   { kind: "update", tag }  — the "Update Available!" line's tap
//   { kind: "page", url }    — a normal tap (a Lunch Money page / fallback)
//   null                     — not a tap: run the boot sequence
// The update tap must be recognized BEFORE the page/fallback checks: it carries
// no ?url=, so cameFromTap() would otherwise route it to the transactions
// fallback page.
async function resolveTap() {
  if (config.runsInWidget) return null;
  await nextTick();
  const tag = tappedUpdateTag();
  if (tag) return { kind: "update", tag };
  const target = tappedTarget();
  if (target) return { kind: "page", url: target };
  if (cameFromTap()) {
    return { kind: "page", url: await fallbackTapUrl() };
  }
  return null;
}

// The ?update= tag a widget's "Update Available!" tap was launched with, or ""
// when this run isn't an update tap. Read like tappedTarget's ?url= (URL-scheme
// arguments land in args.queryParameters).
function tappedUpdateTag() {
  if (config.runsInWidget) return "";
  return String(args.queryParameters.update || "");
}

// Waits one event-loop turn so a cold-starting Scriptable has a moment to finish
// injecting URL-scheme arguments. The delay uses the native Timer class because
// Scriptable's runtime is bare JavaScriptCore and exposes no setTimeout global.
function nextTick() {
  return new Promise((resolve) => {
    const tick = Timer.schedule(0.01, false, () => {
      tick.invalidate();
      resolve();
    });
  });
}

const tapAction = await resolveTap();
if (tapAction && tapAction.kind === "update") {
  // The "Update Available!" line's tap: fetch the new script, copy it to the
  // clipboard, and open this script in the editor so the user can paste over
  // it — no browser, no hunting for the file. Unlike a page tap this leaves the
  // user IN Scriptable (the editor), so it does NOT call App.close().
  await copyUpdateToClipboard(tapAction.tag);
} else if (tapAction) {
  await presentWebPage(tapAction.url);
  // present() resolves only when the user closes the WebView, so this App.close
  // (Scriptable's undocumented return-to-home-screen) fires only after a tapped
  // page was dismissed — never out from under it. Widget renders never reach
  // this branch.
  App.close();
} else {
  // Boot sequence: pull the API key, build the widget, then hand it to
  // Scriptable. Intentionally no App.close(): closing here was what sent a
  // cold-started tap whose URL arguments arrived late (or not at all) straight
  // back to the home screen.
  sweepWidgetStorage();
  LM_ACCESS_TOKEN = await getApiKey();
  const widget = await getWidget();

  Script.setWidget(widget);
  Script.complete();
}

// The Lunch Money deep-link this run was tapped with, or "" when it wasn't a
// widget tap. appDeepLink ships the target as the ?url= query parameter of a
// scriptable:///run URL, and Scriptable exposes those query arguments through
// args.queryParameters (args.shortcutParameter is filled by the Shortcuts app,
// not by URL schemes). Only a real http(s) target counts: anything else (empty,
// a script parameter, junk) means this run isn't a tap and falls through to the
// boot sequence.
function tappedTarget() {
  if (config.runsInWidget) return "";
  const value = String(args.queryParameters.url || "") || launchFallbackText();
  return isHttpUrl(value) ? value : "";
}

// The launch argument Scriptable fills when a run's ?url= query parameter is
// missing: its parameter-less URL-scheme / Shortcuts inputs.
function launchFallbackText() {
  return String(args.queryParameters.parameter || args.shortcutParameter || args.parameter || "");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

// True when any URL-scheme / Shortcuts argument reached this run — i.e. it was
// launched from outside (a widget tap whose ?url= may have been lost in
// transit) rather than run from inside the app or the widget extension.
function cameFromTap() {
  if (config.runsInWidget) return false;
  return hasLaunchArguments();
}

// True when any of the sources Scriptable fills for externally-launched runs
// carried a value (args.queryParameters or the Shortcuts parameter).
function hasLaunchArguments() {
  const params = args.queryParameters || {};
  return Object.keys(params).length > 0 || !!args.shortcutParameter || !!args.parameter;
}

// A tap with no target URL — how lock-screen accessory widgets arrive. Their
// per-widget "When Interacting: Open URL" can only carry a scriptable:///run
// deep-link (no ?url=), so the tap comes in as url-less but real. Open the SAME
// fallback the home screens use (transactionsTapUrl, the widget-wide .url target):
// the displayed period is looked up live so a "previous" accessory lands on the
// period it shows, not the current one. A missing key or failed fetch degrades
// to the plain transactions view rather than booting.
async function fallbackTapUrl() {
  if (!Keychain.contains(API_KEY)) return WEB_APP_URL + "/transactions";
  try {
    LM_ACCESS_TOKEN = Keychain.get(API_KEY);
    const settings = await sendLunchMoneyRequest("/budgets/settings");
    const range = getPeriodRange(settings, tapShowsPreviousPeriod());
    return transactionsTapUrl({ periodStart: range.start_date, periodEnd: range.end_date });
  } catch (e) {
    return WEB_APP_URL + "/transactions";
  }
}

// The "previous" flag for a url-less tap comes from the parameter the configured
// Open URL carries (scriptable:///run?scriptName=…&parameter=previous), falling
// back to the widget parameter Scriptable may have passed through. Lock-screen
// taps reach us via the URL scheme, so args.widgetParameter is normally empty
// and the configured parameter is the source of truth.
function tapShowsPreviousPeriod() {
  const p = String(args.queryParameters.parameter || args.widgetParameter || "").trim().toLowerCase();
  return p === "previous";
}

// Presents a tapped deep-link in a Scriptable WebView. The full-screen modal
// (present(true), not the non-fullscreen default sheet) keeps the view up
// through Scriptable's launch transition so the page isn't dismissed out from
// under the user. The load is kicked off but not awaited: awaiting it up front
// would delay presentation until the page finishes (and hang forever on a page
// that never finishes), while presenting first lets the page stream in behind
// an open view. present() resolves only when the user closes the WebView, so
// the page stays on screen until then. A failed presentation falls back to
// Safari so the tap still lands.
async function presentWebPage(url) {
  try {
    const webView = new WebView();
    webView.loadURL(url).catch(() => {});
    await webView.present(true);
  } catch (e) {
    Safari.open(url);
  }
}

// The "Update Available!" tap handler: download index.js for the newer tag from
// the repo's raw tag URL (the same file the README links for manual installs),
// copy it to the clipboard, then reopen this script in the editor so the user
// can select-all and paste the new version over the old one — a quick two-tap
// upgrade with no browser or file hunting. On any failure it falls back to
// opening the release page so the tap still lands somewhere useful.
async function copyUpdateToClipboard(tag) {
  const releaseUrl = `https://github.com/${UPDATE_REPO}/releases/tag/${encodeURIComponent(tag)}`;
  try {
    const request = new Request(
      `https://raw.githubusercontent.com/${UPDATE_REPO}/refs/tags/${encodeURIComponent(tag)}/index.js`
    );
    request.timeoutInterval = REQUEST_TIMEOUT;
    const source = await request.loadString();
    // A raw 404 page (or any non-script body) shouldn't be pasted over the
    // user's working copy; only accept something that looks like the script.
    if (!source || source.length < 100) throw new Error("empty update body");

    Pasteboard.copyString(source);

    const alert = new Alert();
    alert.title = `Update ${tag} copied`;
    alert.message = "The new version has been copied to your clipboard. Open this script in the editor and paste over the existing code to finish updating.";
    alert.addAction("Open Editor");
    alert.addCancelAction("Later");
    const choice = await alert.presentAlert();
    if (choice === 0) {
      Safari.open(`scriptable:///open?scriptName=${encodeURIComponent(Script.name())}`);
    }
  } catch (e) {
    Safari.open(releaseUrl);
  }
}

/****************************************************
             WIDGET
*****************************************************/

// Builds the complete widget; drops an inline error state when data can't load
async function getWidget() {
  const widget = new ListWidget();
  widget.title = "Lunch Money";
  // Ask WidgetKit to reload the timeline no earlier than when the cache goes
  // stale, so a run lands right after CACHED_MS and fetches fresh data. This is
  // only a hint — iOS budgets background reloads and often delays it — but
  // without it the widget defers entirely to iOS's schedule (hours).
  widget.refreshAfterDate = new Date(Date.now() + CACHED_MS);

  const widgetFamily = config.widgetFamily;
  const layoutConfig = FAMILY_LAYOUTS[widgetFamily] || FAMILY_LAYOUTS.undefined;
  const accessory = !!layoutConfig.accessory;
  // Lock-screen accessories render on a translucent widget backdrop (no gradient)
  // and use the smaller lock-screen margins.
  const padSide = pad(layoutConfig, "padSide", 10);
  widget.setPadding(
    pad(layoutConfig, "padTop", layoutConfig.topPad || TOP_PAD),
    padSide,
    pad(layoutConfig, "padBottom", 14),
    padSide
  );
  if (!accessory) widget.backgroundGradient = getLinearGradient(COLORS.bg1, COLORS.bg2);

  let lunchMoneyData = null;
  let errorMessage = null;
  try {
    lunchMoneyData = await getAllData();
    if (!lunchMoneyData && !LM_ACCESS_TOKEN) {
      // No key configured and nothing to show: point the user at setup
      errorMessage = "Add your Lunch Money API key by running this script in the Scriptable app.";
    } else if (!lunchMoneyData) {
      errorMessage = "Couldn't load Lunch Money data. Check your connection and API key.";
    }
  } catch (e) {
    console.error(e);
    errorMessage = "Couldn't load Lunch Money data.";
  }

  if (errorMessage) {
    addErrorState(widget, errorMessage, layoutConfig);
    return widget;
  }

  // Render the chosen family layout into a vertical stack; anything not
  // assigned a specific tap target falls through to the transactions view.
  // Accessory layouts use explicit spacers, so the stack spacing drops to zero.
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = accessory ? 0 : STACK_SPACING;
  // The widget-wide tap URL (the fallback when no region was hit): the regular
  // transactions view for the period — except on the stacked small widget and the
  // leftover-only lock-screen accessories (circular ring + inline strip), whose
  // single whole-widget target opens Budget, exactly like the small home-screen
  // widget. A small widget supports only ONE tap target (Scriptable/WidgetKit:
  // element urls are honored on medium/large only, and the small widget opens
  // whatever widget.url holds no matter where it's tapped), and the circular and
  // inline accessories are nothing but the metric — the same stacked-widget case
  // — so they take budgetTapUrl too. Set for the accessory families as well:
  // Scriptable's documented behavior ignores .url on lock-screen widgets, but
  // setting it anyway is free — if a given iOS version honors it, accessory taps
  // gain full parity with the home screens (period baked in, no per-widget
  // configuration); if ignored, it's a no-op and the manual per-widget "Open URL"
  // path still covers url-less taps (which open the transactions fallback).
  const budgetTap = layoutConfig.layout === "stacked" || layoutConfig.layout === "accessoryCircular" || layoutConfig.layout === "accessoryInline";
  widget.url = budgetTap ? budgetTapUrl(lunchMoneyData) : transactionsTapUrl(lunchMoneyData);
  renderWidget(mainStack, lunchMoneyData, layoutConfig);

  return widget;
}

// "Leftover" caption plus the given error message, centered
function addErrorState(widget, message, config) {
  addCaption(widget, LEFTOVER_LABEL, config.caption);
  addCenteredText(widget, message, {
    font: smallFont,
    color: regularColor,
    opacity: 0.8
  });
}

// Prefer a fresh cached copy, fetch from the API, then fall back to stale cache
async function getAllData() {
  const fresh = readCache();
  if (fresh) return stampCacheTime(fresh);

  // The last good record of any age. It's both the whole-record fallback (if
  // the headline fetch fails) and the source a failed side-list fetch carries
  // forward, so a transient /transactions error never blanks the unreviewed
  // list or the Delete Pending badge when a previous answer still exists.
  const previous = readCache(true);
  const data = await lunchMoneyLeftoverInfo(previous);

  if (data) {
    data.lastUpdated = Date.now();
    // The update tag is fetched on this (fetch) path only — a fresh cache reuse
    // above skips it — and fetchUpdateInfo throttles itself to once a day, so
    // this costs at most one request per day. The fetch and any tap run share
    // the same on-disk check record. A failed check yields no tag (no notice).
    const update = await fetchUpdateInfo();
    data.updateTag = update && update.tag ? update.tag : "";
    writeCache(data);
    return data;
  }

  // no connection: fall back to stale cache
  return previous ? stampCacheTime(previous) : null;
}

// Cache records predating the lastUpdated field get one retroactively from the
// file's modification time, so the widget can always show when data was fetched
function stampCacheTime(data) {
  if (!data.lastUpdated) data.lastUpdated = cacheModTime();
  return data;
}

/****************************************************
             UI HELPERS
*****************************************************/

// Two-stop top-to-bottom gradient for the widget background
function getLinearGradient(color1, color2) {
  const gradient = new LinearGradient();
  gradient.colors = [new Color(color1), new Color(color2)];
  gradient.locations = [0.0, 1.0];
  return gradient;
}

/****************************************************
             DATA LAYER - API + cache
*****************************************************/

// Returns the stored API key, prompting once and saving it if none exists yet
async function getApiKey() {
  if (Keychain.contains(API_KEY)) {
    return Keychain.get(API_KEY);
  }
  // A widget render can't present the setup prompt; return empty so the widget
  // shows its "add your key" state instead of erroring on a failed Alert.
  if (config.runsInWidget) return "";
  const alert = new Alert();
  alert.addSecureTextField("api_key", "");
  alert.addAction("OK");
  alert.title = "Lunch Money API Key";
  alert.message = "Please enter your lunch money API key, found at https://my.lunchmoney.app/developers";

  await alert.present();
  const apiKey = alert.textFieldValue(0);

  if (apiKey) {
    Keychain.set(API_KEY, apiKey);
  }
  return apiKey;
}

// Query params for a /summary call. include_exclude_from_budgets keeps
// "exclude from budget" categories in the summary: only income and
// "exclude from totals" categories drop out of the leftover, so budget-excluded
// spending must still count as outflow. The discovery call also asks for the
// API's occurrence boundaries, including the prior periods to widen the net if
// the local seed misses the target period.
function summaryParams(range, withOccurrences) {
  return {
    ...range,
    include_totals: true,
    include_rollover_pool: true,
    include_exclude_from_budgets: true,
    ...(withOccurrences ? { include_occurrences: true, include_past_budget_dates: true } : {})
  };
}

// Fetches the summary + categories for the selected budget period (current or
// previous, per the widget parameter), computes the leftover, and pulls the
// latest unreviewed transactions in the same range plus the account-wide
// delete-pending count (period-independent). `previous` is the last good
// cached record (may be null): a failed side-list fetch carries its rows/count
// forward rather than blanking them.
async function lunchMoneyLeftoverInfo(previous) {
  if (!LM_ACCESS_TOKEN) {
    return null;
  }
  try {
    const settings = await sendLunchMoneyRequest('/budgets/settings');
    // Prefer the configured budget period; fall back to the calendar month.
    // "previous" shows the prior period instead of the current one. This seed
    // is then confirmed/corrected against the boundaries the API reports (see
    // reconcilePeriodRange below).
    const seed = getPeriodRange(settings, SHOW_PREVIOUS_PERIOD);
    let [summary, categories, unreviewed, deletePending] = await Promise.all([
      sendLunchMoneyRequest('/summary', summaryParams(seed, true)),
      sendLunchMoneyRequest('/categories'),
      fetchUnreviewedTransactions(seed),
      fetchDeletePendingTransactions()
    ]);
    // Adopt the API's period boundaries. A non-aligned summary omits the
    // budgeted/available fields the leftover math needs, so when the seed
    // missed the real period, refetch pinned to it and repull the unreviewed
    // rows for the corrected range too.
    const range = reconcilePeriodRange(summary, seed);
    if (range.start_date !== seed.start_date || range.end_date !== seed.end_date) {
      [summary, unreviewed] = await Promise.all([
        sendLunchMoneyRequest('/summary', summaryParams(range, false)),
        fetchUnreviewedTransactions(range)
      ]);
    }
    const leftover = computeLeftover(summary, categories);
    // A 200 with an unexpected shape yields no leftover; treat it as a failed
    // fetch so getAllData falls back to the last good cache instead of caching
    // an empty result with a fresh timestamp.
    if (!leftover) return null;
    const now = Date.now();
    // Carry each side list forward on its own: a failed /transactions pull
    // keeps the previous rows/count (and their original fetch time) instead of
    // wiping them. sideListUpdatedAt reads each list's per-field stamp, falling
    // back to the record's own lastUpdated for records that predate it.
    const unreviewedList = carryForwardSideList(
      unreviewed.status, unreviewed.rows,
      previous && previous.unreviewed,
      sideListUpdatedAt(previous, "unreviewedUpdatedAt"),
      now
    );
    const pending = carryForwardSideList(
      deletePending.status, deletePending.count,
      previous && previous.deletePendingCount,
      sideListUpdatedAt(previous, "deletePendingUpdatedAt"),
      now
    );
    return {
      ...leftover,
      periodLabel: periodLabelFor(settings, range),
      periodStart: range.start_date,
      periodEnd: range.end_date,
      unreviewed: unreviewedList.value,
      unreviewedStatus: unreviewedList.status,
      unreviewedUpdatedAt: unreviewedList.updatedAt,
      deletePendingCount: pending.value,
      deletePendingStatus: pending.status,
      deletePendingUpdatedAt: pending.updatedAt
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// The raw /transactions rows for one status, shaped by the caller's params
// (a date range, or nothing). Both status pulls below differ only in this call
// (delete_pending sends no date range and no include_pending), so the request
// shape lives here and the wrappers keep their own mapping + status semantics.
async function fetchTransactions(params, status, includePending = false) {
  const data = await sendLunchMoneyRequest('/transactions', {
    ...params,
    status,
    ...(includePending ? { include_pending: true } : {})
  });
  // A 200 without a transactions array is a malformed response, not an empty
  // list: throw so the wrappers report "failed" rather than "empty".
  if (!data || !Array.isArray(data.transactions)) {
    throw new Error(`/transactions (${status}) returned no transactions array`);
  }
  return data.transactions;
}

// Recent transactions awaiting review in the period, newest first. Filters
// client-side so both v1 ("uncleared") and v2 ("unreviewed") statuses are
// recognized. Returns a status so the layout can tell an empty list (nothing
// to review) apart from a failed fetch (nothing known about the list).
async function fetchUnreviewedTransactions(range) {
  try {
    const raw = await fetchTransactions(range, "unreviewed", true);
    const rows = raw
      .filter((t) => !t.is_group_parent && !t.is_group
        && t.status !== "delete_pending"
        && (UNREVIEWED_STATUSES.includes(t.status) || t.is_pending === true))
      .sort((a, b) => (b.date === a.date
        ? (b.created_at || "").localeCompare(a.created_at || "")
        : b.date.localeCompare(a.date)))
      .map((t) => ({
        payee: t.display_name || t.payee || "Unknown",
        amount: t.to_base != null ? t.to_base : parseFloat(t.amount),
        date: t.date
      }));
    return { rows, status: rows.length > 0 ? "ok" : "empty" };
  } catch {
    return { rows: [], status: "failed" };
  }
}

// Transactions the synced account deleted after they were updated by the user;
// these need manual intervention. Manual deletes are period-independent, so the
// pull sends NO date filter — it counts delete_pending transactions across the
// account's whole history rather than only the displayed period (the API's
// default page size caps it; the badge only tests the count for nonzero).
// Returns a count so the layout can show the Delete Pending badge, and a status
// so a failed fetch can degrade to no badge.
async function fetchDeletePendingTransactions() {
  try {
    const raw = await fetchTransactions({}, "delete_pending");
    return { count: raw.length, status: raw.length > 0 ? "ok" : "empty" };
  } catch {
    return { count: 0, status: "failed" };
  }
}

// Best-known value for an independently fetched side list — the unreviewed rows
// or the delete-pending count. A fetch that didn't fail replaces the value and
// stamps its fetch time; a failed fetch keeps the previous record's last good
// value and its ORIGINAL timestamp, so a transient /transactions error can
// neither wipe known-good data nor relabel stale data as fresh. It reports
// "stale" (a carried-forward list) or "failed" (nothing to fall back on).
// Pure: the wrappers only report the fetch outcome, so the decision is testable
// standalone.
function carryForwardSideList(status, value, prevValue, prevUpdatedAt, now) {
  if (status !== "failed") {
    return { value, status, updatedAt: now };
  }
  const carried = prevValue != null && prevUpdatedAt != null;
  return {
    value: carried ? prevValue : value,
    status: carried ? "stale" : "failed",
    updatedAt: carried ? prevUpdatedAt : now
  };
}

// Looks up the newest release tag without hammering GitHub: the result (and the
// time it was fetched) is cached on disk and reused for UPDATE_CHECK_MS, so the
// API is hit at most once a day. Returns the deferred-check record — always a
// {tag, checkedAt} object (tag null/equal to SCRIPT_VERSION means current) — or
// null on a failed fetch with no cached answer to fall back on. Never throws:
// an update check must never block the widget's own render.
async function fetchUpdateInfo() {
  const cached = readUpdateCheck();
  if (cached && Date.now() - (cached.checkedAt || 0) < UPDATE_CHECK_MS) {
    return cached;
  }
  try {
    const request = new Request(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    request.headers = { "User-Agent": "leftover-lunch-money-widget" };
    request.timeoutInterval = REQUEST_TIMEOUT;
    const release = await request.loadJSON();
    const tag = release && release.tag_name ? String(release.tag_name) : "";
    const info = { tag: tag && tag !== SCRIPT_VERSION ? tag : "", checkedAt: Date.now() };
    writeUpdateCheck(info);
    return info;
  } catch (e) {
    return cached || null;
  }
}

// True when a newer release than SCRIPT_VERSION was found (the update line's
// trigger; pending transactions take precedence over it)
function hasUpdate(data) {
  return !!data && !!data.updateTag;
}

// When a side list was last successfully fetched. The per-field stamp doesn't
// exist on cache records written before it, so those fall back to the record's
// own lastUpdated; null when there is no previous record at all (first run).
function sideListUpdatedAt(previous, field) {
  return previous && (previous[field] || previous.lastUpdated);
}

// GET request against the Lunch Money API: path is relative to BASE_URL (e.g.
// "/summary"). Adds the API key as a Bearer token and appends the query-string
// suffix built from params.
// Rejects on a non-2xx status: the API returns JSON error bodies (e.g. a 401
// {"message":"Unauthorized"} for a bad/expired key), and loadJSON would happily
// parse those as data — caching the error object with a fresh lastUpdated
// instead of letting getAllData fall back to the last good stale copy.
async function sendLunchMoneyRequest(path, params = {}) {
  const headers = {
    'Authorization': LM_ACCESS_TOKEN.includes("Bearer") ? LM_ACCESS_TOKEN : `Bearer ${LM_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const request = new Request(BASE_URL + path + buildQueryString(params));
  request.headers = headers;
  request.method = 'GET';
  request.timeoutInterval = REQUEST_TIMEOUT;
  const data = await request.loadJSON();
  const status = request.response ? request.response.statusCode : 200;
  // The API tags errors with a {message, errors} envelope that no endpoint uses
  // as a payload; treat it as an error too, so a bad key still fails safely if
  // the runtime didn't populate request.response.
  const apiError = data && typeof data.message === "string" && "errors" in data;
  if (status < 200 || status >= 300 || apiError) {
    throw new Error(`Lunch Money API ${path} failed (HTTP ${status})`);
  }
  return data;
}

// "?key=value&..." query suffix, or "" when there are no params
function buildQueryString(params) {
  const entries = Object.entries(params);
  if (entries.length === 0) return "";
  return "?" + entries.map(([key, value]) => `${key}=${value}`).join("&");
}

/****************************************************
             LEFTOVER CALCULATION
*****************************************************/

// Indexes every category (recursively, so children of groups are found) into a
// { id → metadata } map plus a name map for quick lookups later
function indexCategories(categories) {
  const info = {};
  const names = {};
  const add = (category) => {
    info[category.id] = {
      isIncome: category.is_income,
      excludeFromTotals: !!category.exclude_from_totals,
      isGroup: !!category.is_group,
      groupId: category.group_id != null ? category.group_id : null
    };
    names[category.id] = category.name;
    if (Array.isArray(category.children)) category.children.forEach(add);
  };
  (categories.categories || []).forEach(add);
  return { info, names };
}

// Clean metadata lookup for a summary entry; unknown ids get an empty object
function categoryInfo(info, entry) {
  return info[entry.category_id] || {};
}

// Which categories carry budgets at the group level versus in their children,
// so rows that merely mirror an already-budgeted parent/child stay out of the
// sum (see shouldCountEntry)
function budgetGrouping(entries, info) {
  const groupedBudgeted = {};
  const groupHasBudgetedChildren = {};
  for (const entry of entries) {
    const c = categoryInfo(info, entry);
    if (c.isGroup && entry.totals.budgeted != null) {
      groupedBudgeted[entry.category_id] = true;
    } else if (c.groupId != null && entry.totals.budgeted != null) {
      groupHasBudgetedChildren[c.groupId] = true;
    }
  }
  return { groupedBudgeted, groupHasBudgetedChildren };
}

// Shapes one summary entry into a clean budget row { name, initialBudget,
// activity, available, contribution }. The category name comes from the
// indexed names map. `available` comes straight from the API — present
// (possibly null for unbudgeted categories) in aligned responses, absent in
// non-aligned ones — and is normalized to null so the contribution ternary
// below never sees undefined. A budgeted category contributes its budget
// (plus any overspend when available is negative); an unbudgeted one
// contributes its activity.
function shapeBudgetRow(entry, names) {
  const initialBudget = entry.totals.budgeted;
  const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
  const available = entry.totals.available != null ? entry.totals.available : null;
  const contribution = initialBudget == null
    ? activity
    : (available >= 0 ? initialBudget : initialBudget - available);
  return {
    name: names[entry.category_id] || entry.category_id,
    initialBudget,
    activity,
    available,
    contribution
  };
}

// A child row counts only when its group's budget is actually held at the
// group level; a group row counts only when it carries its own budget and no
// children do
function shouldCountEntry(entry, info, groupedBudgeted, groupHasBudgetedChildren) {
  const cat = categoryInfo(info, entry);
  if (cat.groupId != null) {
    return !(groupedBudgeted[cat.groupId] && !groupHasBudgetedChildren[cat.groupId]);
  }
  if (cat.isGroup) {
    if (entry.totals.budgeted == null) return false;
    if (groupHasBudgetedChildren[entry.category_id]) return false;
  }
  return true;
}

// The summary entries contributing to one side of the leftover, after applying
// the same selection the widget uses everywhere else: only income categories
// when isIncome is true (spending categories otherwise), never categories
// flagged "exclude from totals" (transfers, reimbursements, etc.), and group
// rows/children mutually excluded so neither is double-counted. Returns the
// survivors plus the indexed name map so callers can shape or sum them.
function countedEntries(summary, categories, isIncome) {
  const { info, names } = indexCategories(categories);

  const entries = (summary.categories || []).filter((entry) => {
    const cat = categoryInfo(info, entry);
    return !!cat.isIncome === isIncome && !cat.excludeFromTotals;
  });

  const { groupedBudgeted, groupHasBudgetedChildren } = budgetGrouping(entries, info);

  return {
    names,
    entries: entries
      .filter((entry) => shouldCountEntry(entry, info, groupedBudgeted, groupHasBudgetedChildren))
  };
}

// Expands summary rows into per-category budget/activity data, applying group
// rules so groups and their children are never both counted
function categoryRows(summary, categories) {
  const { entries, names } = countedEntries(summary, categories, false);
  return entries.map((entry) => shapeBudgetRow(entry, names));
}

// The period's income under Lunch Money's "max" budget-income option, applied
// PER CATEGORY: every counted income entry contributes the larger of its own
// budget (totals.budgeted) and its own realized activity (other_activity +
// recurring_activity), as a magnitude. A per-category max — not a max of the
// two summed totals — is what keeps an income source that overperforms its
// budget from being masked by another source running below its budget: John's
// Income realizing $12,129.38 against an $11,804.14 budget still counts the
// full $12,129.38 even while Missy's Income sits at its $1,331 budget with no
// activity. This lands on the summary's own totals.inflow.recurring_expected
// figure (received income + budgets not yet received), matching what Lunch
// Money's budget page shows as expected income. Entries without a budget still
// contribute their realized activity; a budgeted-but-unreceived income category
// counts its full budget.
function incomeInflow(summary, categories) {
  const { entries } = countedEntries(summary, categories, true);
  return entries.reduce((total, entry) => {
    const budgeted = entry.totals.budgeted != null ? Math.abs(entry.totals.budgeted) : 0;
    const activity = Math.abs(entry.totals.other_activity || 0) + Math.abs(entry.totals.recurring_activity || 0);
    return total + Math.max(budgeted, activity);
  }, 0);
}

// Money in this period minus what we're on the hook to spend in it. Inflow is
// the general pool Lunch Money calls "budgetable": the period's income — the
// per-category max of expected vs realized (incomeInflow) — plus the rollover
// pool balance carried into it. Outflow is what every category row commits to
// spend plus the uncategorized spend that lives outside all rows, so
// non-budget spending still shrinks the leftover. Returns null when either
// response lacks the arrays the math depends on, so a malformed 200 falls back
// to the last good cache instead of caching an empty result.
function computeLeftover(summary, categories) {
  if (!summary || !Array.isArray(summary.categories)) {
    return null;
  }
  if (!categories || !Array.isArray(categories.categories)) {
    return null;
  }

  const inflow = incomeInflow(summary, categories)
    + ((summary.rollover_pool && summary.rollover_pool.budgeted_to_base) || 0);
  const outflow = categoryRows(summary, categories).reduce((sum, row) => sum + row.contribution, 0)
    + sumBreakdownFields(summary.totals && summary.totals.outflow, OUTFLOW_FIELDS);

  return {
    inflow,
    outflow,
    savings: inflow - outflow
  };
}

// Sum a totals breakdown's named fields (declared as OUTFLOW_FIELDS in the
// configuration block) as non-negative magnitudes, treating a missing
// breakdown or field as zero (never null)
function sumBreakdownFields(breakdown, keys) {
  if (!breakdown) return 0;
  return keys.reduce((total, key) => total + Math.abs(breakdown[key] || 0), 0);
}

/****************************************************
             UTILITIES - formatting + calendar
*****************************************************/

// "$847.22" / "-$1,428.47" style formatting (sign preserved, thousands grouping)
function formatMoney(value) {
  if (!isFinite(value)) return "$0.00";
  const [whole, dec] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (value < 0 ? "-" : "") + "$" + grouped + "." + dec;
}

// Width of one monospace glyph at a given point size — Menlo's advance width is
// ≈ MONO_GLYPH_WIDTH em, so MONO_GLYPH_WIDTH × size. Every width estimate
// below derives from this one source.
function charWidth(size) {
  return MONO_GLYPH_WIDTH * size;
}

// Approximate width of a monospace string: glyph count × charWidth(size)
function textWidth(str, size) {
  return String(str).length * charWidth(size);
}

// YYYY-MM-DD for the API
function formatDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Parse YYYY-MM-DD as a local date (avoiding Date's UTC timezone behavior)
function parseIsoDate(value) {
  const parts = String(value).split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

// Last calendar day of the given month as a local Date; month is 0-based like
// Date's own (day 0 of the following month is the prior month's last day), so
// under/overflowing month arithmetic (e.g. monthOffset -1) still lands right.
function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

// Steps date by count budget periods (positive moves forward, negative moves
// back) using the account's period quantity + granularity. Backward walking is
// how callers find the period before a given target date.
function addBudgetPeriod(date, settings, count) {
  const d = new Date(date.getTime());
  const quantity = settings.budget_period_quantity || 1;
  const granularity = settings.budget_period_granularity || "month";
  const step = Math.sign(count) || 1;
  for (let i = 0; i < Math.abs(quantity * count); i++) {
    switch (granularity) {
      case "day":
        d.setDate(d.getDate() + step);
        break;
      case "week":
        d.setDate(d.getDate() + 7 * step);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + step);
        // Clamp Feb 29 crossings to the prior month's last day
        if (d.getMonth() !== date.getMonth()) d.setDate(0);
        break;
      case "twice a month":
        d.setDate(d.getDate() + 15 * step);
        break;
      default: // "month" and any unexpected value behave as months
        addMonthsClamped(d, step);
    }
  }
  return d;
}

// Shift by n months but clamp the day so dates like Jan 31 never overflow into March
function addMonthsClamped(date, n) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = lastDayOfMonth(target.getFullYear(), target.getMonth()).getDate();
  date.setFullYear(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
}

// Walks the anchor date until the period containing the target date is found:
// forward normally, backward when the anchor sits in the future.
function getBudgetPeriodForDate(settings, targetDate) {
  if (!settings || !settings.budget_period_anchor_date) return null;
  const anchor = parseIsoDate(settings.budget_period_anchor_date);
  if (isNaN(anchor.getTime())) return null;
  const target = new Date(targetDate.getTime());
  target.setHours(0, 0, 0, 0);
  anchor.setHours(0, 0, 0, 0);

  let periodStart = new Date(anchor.getTime());
  if (periodStart > target) {
    while (periodStart > target) {
      periodStart = addBudgetPeriod(periodStart, settings, -1);
    }
  } else {
    let next = addBudgetPeriod(periodStart, settings, 1);
    while (next <= target) {
      periodStart = next;
      next = addBudgetPeriod(periodStart, settings, 1);
    }
  }

  let periodEnd = addBudgetPeriod(periodStart, settings, 1);
  periodEnd.setDate(periodEnd.getDate() - 1);

  if (settings.budget_use_last_day_of_month && settings.budget_period_granularity === "month") {
    periodEnd = lastDayOfMonth(periodEnd.getFullYear(), periodEnd.getMonth());
  }

  return {
    start_date: formatDateString(periodStart),
    end_date: formatDateString(periodEnd)
  };
}

// Budget period containing today
function getCurrentBudgetPeriod(settings) {
  return getBudgetPeriodForDate(settings, new Date());
}

// Budget period immediately before the current one: the period containing the
// day before the current period starts
function getPreviousBudgetPeriod(settings) {
  const current = getCurrentBudgetPeriod(settings);
  if (!current) return null;
  const prevEndTarget = parseIsoDate(current.start_date);
  prevEndTarget.setDate(prevEndTarget.getDate() - 1);
  return getBudgetPeriodForDate(settings, prevEndTarget);
}

// The range the widget shows for the requested period: the account's configured
// budget period, or a calendar-month fallback when none is configured
function getPeriodRange(settings, previous) {
  const custom = previous ? getPreviousBudgetPeriod(settings) : getCurrentBudgetPeriod(settings);
  return custom || getCalendarMonthRange(previous ? -1 : 0);
}

// Fallback range when the account has no custom budget period. The offset
// shifts the month: 0 = the current calendar month, -1 = the previous one.
function getCalendarMonthRange(monthOffset) {
  const now = new Date();
  return {
    start_date: formatDateString(new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)),
    end_date: formatDateString(lastDayOfMonth(now.getFullYear(), now.getMonth() + monthOffset))
  };
}

// The account's real budget-period boundaries, straight from the API. A
// /summary request sent with include_occurrences returns each category an
// `occurrences` array of the periods it covers; every category shares the same
// boundaries, so the first non-empty list describes them all. Empty when the
// response predates or omits the field.
function summaryOccurrences(summary) {
  if (!summary || !Array.isArray(summary.categories)) return [];
  for (const entry of summary.categories) {
    if (entry && Array.isArray(entry.occurrences) && entry.occurrences.length > 0) {
      return entry.occurrences;
    }
  }
  return [];
}

// The occurrence overlapping `seed` the most, in milliseconds. Non-overlapping
// occurrences score 0, so a seed that misses every returned period yields null.
function mostOverlappingOccurrence(occurrences, seed) {
  const seedStart = parseIsoDate(seed.start_date).getTime();
  const seedEnd = parseIsoDate(seed.end_date).getTime();
  let best = null;
  let bestOverlap = 0;
  for (const occ of occurrences) {
    const overlap = Math.min(seedEnd, parseIsoDate(occ.end_date).getTime())
      - Math.max(seedStart, parseIsoDate(occ.start_date).getTime());
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = occ;
    }
  }
  return best;
}

// Reconcile the locally computed period range with the boundaries the API
// actually used. When the seed lands on a real period the returned range equals
// it (the aligned common case); when the seed misses — a wrong anchor, or a
// granularity the local walk doesn't model (e.g. "twice a month") — the range
// is corrected to the occurrence overlapping it. Falls back to the seed when
// the response carries no occurrences.
function reconcilePeriodRange(summary, seed) {
  const best = mostOverlappingOccurrence(summaryOccurrences(summary), seed);
  return best ? { start_date: best.start_date, end_date: best.end_date } : seed;
}

// Header label for the displayed period: the actual month name(s) when periods
// are calendar months, otherwise a generic pay-period label that says which
// period is shown
function periodLabelFor(settings, range) {
  const monthBased = ((settings && settings.budget_period_granularity) || "month") === "month";
  if (!monthBased) {
    return SHOW_PREVIOUS_PERIOD ? "PREVIOUS PAY PERIOD" : "CURRENT PAY PERIOD";
  }
  const start = parseIsoDate(range.start_date);
  const end = parseIsoDate(range.end_date);
  const startMonth = MONTHS[start.getMonth()].toUpperCase();
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return startMonth;
  }
  return startMonth + "\u2013" + MONTHS[end.getMonth()].toUpperCase();
}

/****************************************************
             STORAGE
*****************************************************/

// Path helpers: the Scriptable folder used for the cache, and the cache file
// inside it
function widgetFolder() {
  return FileManager.local().documentsDirectory() + "/" + BASE_FILE;
}
function cachePath() { return widgetFolder() + "/" + CACHE_KEY; }

// Cache file modification time (ms since epoch); returns now on any error
function cacheModTime() {
  try { return FileManager.local().modificationDate(cachePath()).getTime(); }
  catch (e) { return Date.now(); }
}

// Idempotently ensures the widget folder exists (createDirectory(_, true) is
// a no-op when it's already there)
function ensureWidgetFolder() {
  const fm = FileManager.local();
  fm.createDirectory(widgetFolder(), true);
  return widgetFolder();
}

// Reads the cached result JSON; TTL-gated unless allowStale is set (offline
// fallback)
function readCache(allowStale) {
  const fm = FileManager.local();
  const path = cachePath();
  try {
    const raw = fm.readString(path);
    if (raw && (allowStale || Date.now() - fm.modificationDate(path) <= CACHED_MS)) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // unreadable or corrupt cache: treat as a miss
  }
  return null;
}

// Persists the latest result to the cache file. Best-effort: a failed write
// must not discard freshly fetched data, so the widget still renders this run
// and the next run simply re-fetches.
function writeCache(data) {
  try {
    const fm = FileManager.local();
    ensureWidgetFolder();
    fm.writeString(cachePath(), JSON.stringify(data));
  } catch (e) {
    // ignore: rendering proceeds with the in-memory result
  }
}

// Best-effort janitor for Scriptable's widget folder: removes every entry that
// isn't a current period cache (CACHE_FILE_NAMES) or the update-check record
// (UPDATE_CHECK_KEY), so retired or unexpected
// files — the dropped diagnostics.txt, OS cruft like .DS_Store, anything a
// future version stops using — can't linger on device. Runs on the boot path
// only and never touches the caches or the update record, so it's safe on every
// run.
function sweepWidgetStorage() {
  const fm = FileManager.local();
  const folder = widgetFolder();
  const keep = CACHE_FILE_NAMES.concat(UPDATE_CHECK_KEY);
  try {
    if (!fm.fileExists(folder)) return;
    for (const entry of fm.listContents(folder)) {
      if (!keep.includes(entry)) fm.remove(folder + "/" + entry);
    }
  } catch (e) {
    // best-effort: a failed sweep must not block the boot sequence
  }
}

// The update-check record lives OUTSIDE the per-period cache files (it's not
// period data), which is why the sweep above keeps UPDATE_CHECK_KEY.
function updateCheckPath() { return widgetFolder() + "/" + UPDATE_CHECK_KEY; }

// The last update-check result ({tag, checkedAt}) or null when none is stored
function readUpdateCheck() {
  try {
    const raw = FileManager.local().readString(updateCheckPath());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Persists the update-check record; best-effort like writeCache
function writeUpdateCheck(info) {
  try {
    const fm = FileManager.local();
    ensureWidgetFolder();
    fm.writeString(updateCheckPath(), JSON.stringify(info));
  } catch (e) {
    // ignore: the check simply re-runs next time
  }
}

/****************************************************
             WIDGET LAYOUTS
*****************************************************/

// Top-level renderer: picks the layout's body from LAYOUT_RENDERERS (extraLarge
// maps to the breakdown entry; anything unknown falls back to it too)
function renderWidget(mainStack, data, config) {
  const renderer = LAYOUT_RENDERERS[config.layout] || LAYOUT_RENDERERS.breakdown;
  renderer(mainStack, data, config);
}

// Header on top, a fixed gap, a body section, and a trailing flexible spacer —
// the shape shared by the review and overview layouts
function withHeaderAndSpacer(mainStack, data, config, gap, body) {
  addHeader(mainStack, data, config);
  mainStack.addSpacer(gap);
  body(mainStack, data, config);
  mainStack.addSpacer();
}

// extraLarge body: Leftover amount plus Inflow / Outflow detail lines. Fed to
// withHeaderAndSpacer like the review/overview bodies. Taps open Budget.
function addBreakdownSection(parent, data, config) {
  const budget = parent.addStack();
  budget.layoutVertically();
  budget.url = budgetTapUrl(data);
  addCaption(budget, LEFTOVER_LABEL, config.caption);
  addAmount(budget, data.savings, { size: config.amount });
  budget.addSpacer(LIST_BODY_GAP);
  addBreakdown(budget, data, detailFontSize(config));
}

// Inflow / Outflow / Leftover stacked vertically (small, in-app preview).
// Labels hug the left edge while the monetary amounts right-justify, so the
// cents line up across rows. Taps: the small widget supports only ONE tap
// target (Scriptable/WidgetKit: element urls are honored on medium/large only),
// so the whole widget's tap opens Budget via widget.url — neither the
// Delete Pending label nor the metrics carry their own stack urls here (they'd
// never fire). When synced transactions await a manual delete — or, with none,
// a newer release is available — the same caption-weighted line the list
// layouts show ("Deleted Transactions Pending!" in red, else "Update
// Available!" in green) tops the metrics above the Inflow caption. It needs only
// leanLineHeight(caption) of the widget's real on-device slack (WidgetKit lays
// Avenir tighter than Font.lineHeight — the same slack the review layout
// reclaims for row counts), so no existing size or padding changes; a full
// caption-weight line also reads as the alert it is.
function addStackedMetrics(parent, data, config) {
  const stack = parent.addStack();
  stack.layoutVertically();
  stack.layoutWeight = 1;
  stack.topAlignContent();
  if (hasBadgeLine(data)) addDeletePendingBadge(stack, data, config, { alignLeft: true });
  addMetrics(stack, data, config, {
    amountSize: config.amount,
    alignRight: true,
    captionLeft: true
  });
}

// The "LUNCH MONEY" brand text, left- or center-aligned per layout. Shared by
// both title branches so the two can't drift apart.
function addBrandTitleText(parent, align) {
  const title = parent.addText("LUNCH MONEY");
  title.font = boldFont(TITLE_SIZE);
  title.textColor = brandGreen;
  title.lineLimit = 1;
  if (align === "left") title.leftAlignText(); else title.centerAlignText();
  return title;
}

// The "@ H:MM AM/PM" timestamp label with the shared smaller font + period
// color. The centered layout renders it twice — once invisible (textOpacity 0)
// as the width-balancing mirror, once as the visible text — so both go through
// here and stay exactly the same width.
function addTimestamp(parent, timeText, config, invisible) {
  const label = parent.addText(timeText);
  label.font = timestampFont(config);
  label.textColor = regularColor;
  label.lineLimit = 1;
  if (invisible) label.textOpacity = 0;
  return label;
}

// Brand title row. On the header-based widgets (review / overview / breakdown)
// LUNCH MONEY stays dead-center with the timestamp right next to it
// (TITLE_TIME_GAP apart): an invisible mirror of the time balances the time +
// gap on the left and the two flexible spacers share the rest, so the centering
// never shifts whether or not the time is rendered. The small stacked widget
// has no room to center beside the time, so its title left-justifies like
// the Inflow caption and the time trails after (the Delete Pending label tops
// the metrics below, addStackedMetrics).
// centerAlignContent levels the smaller timestamp with the title on every
// layout.
function addBrandTitle(parent, data, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const timeText = (data && config) ? formatUpdateTime(data.lastUpdated) : "";
  const separatedTime = (invisible) => {
    row.addSpacer(TITLE_TIME_GAP);
    addTimestamp(row, timeText, config, invisible);
  };
  if (config && config.layout === "stacked") {
    addBrandTitleText(row, "left");
    if (timeText) separatedTime(false);
    return;
  }
  if (timeText) separatedTime(true);
  row.addSpacer();
  addBrandTitleText(row, "center");
  if (timeText) separatedTime(false);
  row.addSpacer();
}

// The shared top-of-list line, shown once at the TOP of the unreviewed list
// column — above the "Unreviewed Transactions" caption — on review, overview,
// and rectangular-accessory layouts, styled as exactly the caption's font and
// size (boldFont(config.caption)), on one line that never scales down. It
// carries one of two messages, pending deletes taking precedence over an update:
//   - pending deletes (data.deletePendingCount > 0): "Deleted Transactions
//     Pending!" in the palette's loss red, tapping through to EVERY transaction
//     filtered to status=delete_pending — no date filter, so it shows all of
//     them regardless of the widget's period.
//   - otherwise, an available update (data.updateTag): "Update Available!" in
//     the UPDATE_GREEN, tapping through to the copy-the-new-script flow (fetch
//     index.js, copy it, reopen the editor) — the widget has no updater of its
//     own.
// It stays on one line — the longer pending label fits the narrowest list column
// (~188pt on the SE 1st-gen medium vs ≈186pt at 13pt, and ≈143pt at the
// rectangular accessory's 10pt caption vs a 145pt inner width), so it never
// needs to scale down. It reserves leanLineHeight(caption) + LIST_BOTTOM_SLACK
// via deletePendingBadgeHeight so the list loses part of one row while it's up
// and never runs flush against the widget's height limit (flush lists can clip
// the widget top). The label is NOT placed inside any stack that already carries
// a tap URL — the parent column stack drops the unreviewed URL so Scriptable's
// tap hit-testing resolves to the label's own URL (a parent stack's URL can
// shadow a child label's).
// Alignment mirrors the "Unreviewed Transactions" caption it sits above:
// centered on the large widget (addOverview), left-aligned on the medium
// (addReviewSplit) and the rectangular accessory (addAccessoryRectangular) via
// the same addTextRow alignment the caption uses. The accessory also stretches
// the badge row across the column (stretch), matching the caption and the
// transaction rows' flush-left edge under the lock screen's centering stack,
// and overrides the pending red with the standard label color (brandYellow) —
// lock screens color labels one way and amounts another, so the badge reads as a
// label there instead of as a loss amount.
function addDeletePendingBadge(parent, data, config, opts = {}) {
  const updateOnly = !hasDeletePending(data) && hasUpdate(data);
  const { row, label } = addTextRow(parent, updateOnly ? BADGE_UPDATE_LABEL : BADGE_PENDING_LABEL, {
    font: boldFont(config.caption),
    color: opts.color || (updateOnly ? updateGreen : lossRed),
    alignLeft: opts.alignLeft,
    stretch: opts.stretch
  });
  label.lineLimit = 1;
  label.url = updateOnly ? updateTapUrl(data) : deletePendingTapUrl();
  return label;
}

// Inflow / Leftover / Outflow across the width as three equal columns that scale
function addMetricRow(parent, data, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  // Leftover sits between Inflow and Outflow in this split layout — an order
  // that differs from the METRICS table (see OVERVIEW_METRIC_ORDER).
  for (const id of OVERVIEW_METRIC_ORDER) {
    addMetricColumn(row, getMetric(id), data, config);
  }
  return row;
}

// One metric column; layoutWeight divides the row equally so it scales across sizes
function addMetricColumn(parentRow, metric, data, config) {
  const col = parentRow.addStack();
  col.layoutVertically();
  col.layoutWeight = 1;
  col.spacing = STACK_SPACING;
  addCaption(col, metric.label, config.caption);
  // Leftover colors by sign (no color set), other metrics stay white
  addAmount(col, metric.value(data), { size: config.amount, color: metric.color });
}

// The unreviewed transactions column shared by the medium (review), large
// (overview), and rectangular-accessory layouts: an optional top-of-list line
// (the Delete Pending or Update Available badge) above the "Unreviewed
// Transactions" caption, then the rows. On the home
// screens the caption row and the list stack both carry the unreviewed tap URL —
// the "limit the unreviewed tap target to the label + list rows" convention —
// while the badge's own URL (delete-pending or update) stays reachable because
// neither its parent column nor any ancestor stack sets a URL (a parent
// stack's url can shadow a child's). The lock-screen rectangular accessory keeps
// the whole column URL-free (tappable: false) so a tap anywhere on it can never
// shadow the badge target, and it passes the accessory's stretch + label-color
// options.
function addUnreviewedSection(parent, data, config, opts = {}) {
  if (hasBadgeLine(data)) {
    addDeletePendingBadge(parent, data, config, opts);
  }
  const caption = addCaption(parent, "Unreviewed Transactions", config.caption, opts.alignLeft, opts.stretch);
  const list = parent.addStack();
  list.layoutVertically();
  if (opts.tappable !== false) {
    // One URL shared by both tap targets (the caption row and the list stack):
    // the unreviewed target derives from the same period data, so build it once
    // rather than recomputing it per target.
    const url = unreviewedTapUrl(data);
    caption.row.url = url;
    list.url = url;
  }
  addUnreviewedItems(list, data, config);
}

// Large layout: metric columns across the width plus the unreviewed list below.
function addOverview(mainStack, data, config) {
  const metricRow = addMetricRow(mainStack, data, config);
  metricRow.url = budgetTapUrl(data);
  mainStack.addSpacer(LIST_BODY_GAP);
  const unreviewed = mainStack.addStack();
  unreviewed.layoutVertically();
  unreviewed.spacing = STACK_SPACING;
  addUnreviewedSection(unreviewed, data, config);
}

// Medium layout: metrics top-aligned on the left, unreviewed transactions on the right
function addReviewSplit(mainStack, data, config) {
  const row = mainStack.addStack();
  row.layoutHorizontally();

  const left = row.addStack();
  left.layoutVertically();
  left.layoutWeight = METRICS_WEIGHT;
  left.url = budgetTapUrl(data);
  addMetrics(left, data, config, { amountSize: config.amount, alignLeft: true });
  left.addSpacer();
  left.addSpacer(LIST_BODY_GAP);

  const right = row.addStack();
  right.layoutVertically();
  right.layoutWeight = LIST_WEIGHT;
  addUnreviewedSection(right, data, config, { alignLeft: true });
  right.addSpacer();
}

// Lock-screen rectangular accessory: a Leftover line, an Unreviewed caption
// (with a Delete Pending label above it when transactions await deletion), and
// as many transaction rows as the accessory's height allows — no header, no
// metrics columns. Rows fit via the same addUnreviewedItems budget path as
// the medium review list; the trailing flex spacer absorbs the leftover points.
function addAccessoryRectangular(mainStack, data, config) {
  const leftover = mainStack.addStack();
  leftover.layoutHorizontally();
  // The label and amount share one point size, so their line boxes are equal
  // and center-alignment lands them on the same baseline (the same arrangement
  // addDetailRow uses for its aligned label+value rows).
  leftover.centerAlignContent();
  addCaption(leftover, LEFTOVER_LABEL, config.caption, true);
  addAmount(leftover, data.savings, { size: config.amount, alignRight: true });

  mainStack.addSpacer(ACC_HEADER_GAP);

  const unreviewed = mainStack.addStack();
  unreviewed.layoutVertically();
  addUnreviewedSection(unreviewed, data, config, {
    alignLeft: true,
    stretch: true,
    color: brandYellow,
    tappable: false
  });
  mainStack.addSpacer();
}

// Lock-screen circular accessory: the "Leftover" caption stacking above the
// amount, both at fixed sizes from the FAMILY_LAYOUTS entry. The caption is
// kept smaller than the amount (9 vs 13pt) so the two lines fit the ring on
// every device.
// Centered on both axes: flexible spacers above and below do the vertical
// centering (layoutWeight is unreliable inside accessory widgets), and
// addCaption / addAmount each center their line horizontally.
function addAccessoryCircular(mainStack, data, config) {
  mainStack.addSpacer();
  addCaption(mainStack, LEFTOVER_LABEL, config.caption);
  addAmount(mainStack, data.savings, { size: config.amount });
  mainStack.addSpacer();
}

// Lock-screen inline accessory (the single line above the clock): Scriptable
// forces its own system typeface, so this is just "Leftover <amount>" as plain
// text — not addAmount, which would try to use Menlo-Bold and re-center.
function addAccessoryInline(mainStack, data, config) {
  const label = mainStack.addText(LEFTOVER_LABEL + " " + formatMoney(data.savings));
  label.textColor = regularColor;
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.5;
}

// Inflow / Outflow / Leftover rows, sharing one caption + amount style.
// The medium layout (alignLeft) right-justifies amounts inside a reserved
// column, so the decimals share one right edge and the gap to the unreviewed
// list is the same on all three rows; the small layout (alignRight) right-aligns
// too but with captionLeft left-justifying the labels rather than centering.
// amountSize is a single size shared by all three rows.
function addMetrics(parent, data, config, opts) {
  const columnWidth = metricColumnWidth(opts.amountSize, opts.alignLeft);
  for (const metric of METRICS) {
    const alignCaption = opts.captionLeft !== undefined ? opts.captionLeft : opts.alignLeft;
    addCaption(parent, metric.label, config.caption, alignCaption);
    addAmount(parent, metric.value(data), {
      size: opts.amountSize,
      color: metric.color,
      alignLeft: opts.alignLeft,
      minWidth: columnWidth,
      alignRight: opts.alignRight
    });
  }
}

// Fixed reserve for a left-aligned metrics column: room for the widest
// plausible figure at the row's size, plus the gap that separates the
// right-justified amounts from the unreviewed list (METRIC_LIST_GAP). Keeping
// it a pure function of the font size means the list position (and the margin
// on every row) never shifts with the amounts or the list content.
function metricColumnWidth(size, alignLeft) {
  if (!alignLeft) return undefined;
  return textWidth(MAX_MONEY, size) + METRIC_LIST_GAP;
}

// Every unreviewed transaction that fits without clipping, or an inline notice
// when there's nothing to review (or the list couldn't load). The count is
// derived from the widget's fixed height minus everything rendered above the
// list, so we never let a row run past the widget's bottom edge.
function addUnreviewedItems(parent, data, config) {
  const items = (data.unreviewed || []).slice(0, maxUnreviewedCount(data, config));
  if (items.length === 0) {
    addUnreviewedEmpty(parent, data.unreviewedStatus, config);
  } else {
    // A carried-forward list ("stale") renders dimmed, so a list we couldn't
    // refresh this run reads as older than the widget's timestamp suggests.
    const stale = data.unreviewedStatus === "stale";
    items.forEach((t) => addTransactionRow(parent, t, config, stale));
  }
}

// Vertical points available to the unreviewed list after padding, header,
// spacers, metric rows, and the section caption are accounted for
function listHeightBudget(data, config) {
  const height = WIDGET_HEIGHTS[config.layout];
  if (config.layout === "review") {
    // medium: list shares the row's fixed height with the metrics column; the
    // top Delete Pending badge reserves its line + LIST_BOTTOM_SLACK
    // (deletePendingBadgeHeight) before the rows. The header and caption are
    // reserved at the LEAN line box — WidgetKit lays text tighter than
    // Font.lineHeight (the same visible slack the small widget's badge line
    // lives in) — so the rows pick up the space that actually shows instead of
    // leaving it empty.
    const header = headerHeight(config, leanLineHeight);
    return height - PADDING_Y - header - REVIEW_GAP
      - leanLineHeight(config.caption) - deletePendingBadgeHeight(data, config);
  }
  if (config.layout === "accessoryRectangular") {
    // rectangular accessory: leftover line + caption above the list, with tight
    // lock-screen margins (ACC_PAD_TOP / ACC_PAD_BOTTOM / ACC_HEADER_GAP) plus
    // ACC_SLACK so the last row never touches the widget's bottom edge. The
    // leftover line's height is whichever of its caption/amount is taller; a
    // Delete Pending badge reserves its own line (deletePendingBadgeHeight)
    // above the caption, exactly as in the review budget.
    const leftoverLine = Math.max(monoLineHeight(config.amount), lineHeight(config.caption));
    return height - pad(config, "padTop", ACC_PAD_TOP) - pad(config, "padBottom", ACC_PAD_BOTTOM)
      - leftoverLine - ACC_HEADER_GAP - lineHeight(config.caption)
      - deletePendingBadgeHeight(data, config) - ACC_SLACK;
  }
  if (config.layout === "overview") {
    const metricRowH = lineHeight(config.caption) + STACK_SPACING + monoLineHeight(config.amount);
    return height - PADDING_Y - headerHeight(config) - OVERVIEW_GAP - metricRowH
      - LIST_BODY_GAP - lineHeight(config.caption) - deletePendingBadgeHeight(data, config);
  }
  return 0;
}

// One transaction row: text line plus the trailing ROW_GAP spacer between rows.
// Rows render in regular Monospaced Menlo (monoFont), so the pitch is measured
// with monoRegularLineHeight — the exact font the rows draw in, never
// lineHeight (Avenir, the small widget's measure) and never Menlo-Bold (that's
// the amounts' measure, monoLineHeight). The trailing spacer MUST match the
// +ROW_GAP in rowFitHeight so the fitted row count matches what the render
// actually draws (see addTransactionRow).
function rowFitHeight(config) {
  return monoRegularLineHeight(detailFontSize(config)) + ROW_GAP;
}

// How many rows fit: the budget divided by the row pitch. The trailing
// flexible spacer absorbs whatever's left, so rows can run right up to the
// widget's bottom edge.
function maxUnreviewedCount(data, config) {
  const items = data.unreviewed || [];
  if (items.length === 0) return 0;
  const count = Math.max(1, Math.floor(listHeightBudget(data, config) / rowFitHeight(config)));
  return Math.min(items.length, count);
}

// The layout's secondary-text size: the per-layout detailFont with a
// caller-supplied fallback (9 for unreviewed rows; 11 so the small timestamp
// matches medium's instead of bottoming out at 7pt). The single source every
// detail-sized measure derives from, so a size tweak lands everywhere.
function detailFontSize(config, fallback) {
  const size = config && config.detailFont;
  return size || fallback || 9;
}

// Font for the "No unreviewed transactions" notice: Avenir at the layout's
// detail size so secondary text shares one size.
function unreviewedFont(config) {
  return font(detailFontSize(config));
}

// Secondary helper-text size: one point below the layout's detail text, floored
// at 7pt so it stays readable. Used by the title timestamp and the
// failed-unreviewed hint. The fallback sizes detailFontSize when the layout has
// no detailFont of its own: small feeds 11 (medium's detail size) for the
// timestamp — so it matches the medium timestamp rather than hitting the 7pt
// floor — and defaults to 9 for the failed hint.
function smallDetailSize(config, fallback) {
  return Math.max(7, detailFontSize(config, fallback) - 2);
}

// Font for the title-line "@ H:MM AM/PM" timestamp
function timestampFont(config) {
  return font(smallDetailSize(config, 11));
}

// Unreviewed section fallback: a plain "nothing to review" notice matching the
// transaction-row font, or a "couldn't load" hint one size smaller when the
// fetch failed.
function addUnreviewedEmpty(parent, status, config) {
  const failed = status === "failed";
  const text = failed ? "Couldn't load unreviewed" : "No unreviewed transactions";
  const empty = parent.addText(text);
  empty.font = failed ? font(smallDetailSize(config)) : unreviewedFont(config);
  empty.textColor = regularColor;
  empty.textOpacity = failed ? 0.8 : 0.6;
  empty.lineLimit = 3;
  empty.minimumScaleFactor = 0.6;
}

// One unreviewed transaction: payee + amount on a single line (no date). A
// stale row (a list carried forward after a failed refresh) renders at reduced
// opacity to signal its age against the widget's fresh timestamp.
function addTransactionRow(parent, t, config, stale = false) {
  const row = parent.addStack();
  row.layoutHorizontally();
  // The Menlo rows sit a hair left of the Avenir caption/badge above them (the
  // faces' left bearings differ), so they take a MENLO_LEFT_INSET leading
  // nudge to share the caption's visual left edge — on the layouts whose
  // caption is left-aligned (medium review + rectangular accessory).
  if (menloInsetLayout(config)) row.addSpacer(MENLO_LEFT_INSET);
  const fontSize = detailFontSize(config);
  // The payee is capped by the row's real width (medium review list column or
  // rectangular accessory inner width) so a long name truncates with "…"
  // instead of running into its amount; other layouts keep the fixed char cap.
  const maxPayee = payeeMax(config);
  const payee = row.addText(clip(t.payee, maxPayee));
  payee.font = monoFont(fontSize);
  payee.textColor = regularColor;
  payee.lineLimit = 1;
  row.addSpacer();
  // Lunch Money stores expenses as positive and income as negative; expenses
  // get a "-" in red, income a "+" in regular green
  const isInflow = t.amount < 0;
  const amount = row.addText((isInflow ? "+" : "-") + formatMoney(Math.abs(t.amount)));
  amount.font = monoFont(fontSize);
  amount.lineLimit = 1;
  amount.textColor = isInflow ? incomeGreen : expenseRed;
  if (stale) {
    payee.textOpacity = STALE_ROW_OPACITY;
    amount.textOpacity = STALE_ROW_OPACITY;
  }

  // Trailing ROW_GAP spacer between rows; matches rowFitHeight's ROW_GAP
  parent.addSpacer(ROW_GAP);
}

// Available width for the dynamic payee cap: the medium review list column or
// the rectangular accessory's inner width. Returns null for layouts that use
// the fixed payeeLen from their config.
function listWidth(config) {
  if (config.layout === "review") return LIST_COLUMN_WIDTH;
  if (config.layout === "accessoryRectangular") return ACCESSORY_SIZE.rectW - 2 * ACC_PAD_SIDE;
  return null;
}

// Layouts whose unreviewed list sits under a LEFT-aligned Avenir caption (or
// the badge line above it): the medium review split and the lock-screen
// rectangular accessory. Their Menlo rows take the MENLO_LEFT_INSET leading
// nudge (addTransactionRow) so they share the caption's visual left edge, and
// the payee budget subtracts the same points (payeeMax). The large overview's
// caption is centered, so no shared left edge exists there.
function menloInsetLayout(config) {
  return config.layout === "review" || config.layout === "accessoryRectangular";
}

// Max payee characters on one transaction row so a name truncates with "…"
// while always leaving room for the fixed gap and the widest signed amount.
// Widths come from the real list width the layout hands the row (listWidth) —
// never the whole widget, so long names use the space the layout actually
// gives them. Other layouts (large/extraLarge) use the fixed payeeLen from
// their config.
function payeeMax(config) {
  const fs = detailFontSize(config);
  const width = listWidth(config);
  if (width == null) return config.payeeLen || 16;
  const inset = menloInsetLayout(config) ? MENLO_LEFT_INSET : 0;
  const room = Math.max(0, width - inset - INLINE_GAP - textWidth(MAX_SIGNED_MONEY, fs));
  return Math.max(4, Math.floor(room / charWidth(fs)));
}

// Truncate to max characters, hinting overflow with an ellipsis
function clip(text, max) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Title + budget period label rows, used by every layout that has a header. An
// optional per-layout headerPad drops the block a few points lower; the trailing
// flexible spacer in the caller keeps the body pinned in place.
function addHeader(mainStack, data, config) {
  if (config && config.headerPad) mainStack.addSpacer(config.headerPad);
  // Title + period share one nested stack so their gap (headerGap) can be
  // tighter than the mainStack spacing; headerHeight keeps the budgets in sync.
  const header = mainStack.addStack();
  header.layoutVertically();
  header.spacing = headerBlockGap(config);
  addBrandTitle(header, data, config);
  addCenteredText(header, budgetPeriodLabel(data), {
    font: font(PERIOD_SIZE),
    color: regularColor
  });
}

// Text shown under the title: the displayed period's label (see periodLabelFor)
function budgetPeriodLabel(data) {
  return (data && data.periodLabel) || MONTHS[new Date().getMonth()].toUpperCase();
}

// A single centered line: flexible spacers on both sides keep the label
// centered, so it takes the full width even in a mixed-size layout
function addCenteredText(parent, text, style) {
  const { label } = addTextRow(parent, text, {
    font: style.font,
    color: style.color,
    alignLeft: false
  });
  if (style.opacity != null) label.textOpacity = style.opacity;
  return label;
}

/****************************************************
             UI PRIMITIVES - shared text rows
*****************************************************/

// One horizontal row holding a single styled text. Alignment is chosen with an
// alignLeft / alignRight flag, defaulting to centered: centered lines get
// flexible spacers on both sides so the text pins mid-width, left-aligned lines
// hug the text with no spacer (a trailing flex spacer inflates the row's
// implicit width and widens the column), and right-aligned lines add a leading
// flex spacer. stretch makes a left-aligned row span the column anyway (a
// trailing flex spacer), so under WidgetKit's lock-screen stacking — which
// centers children that don't fill — the line pins to the same flush-left edge
// as the full-width transaction rows instead of floating right; on the
// home-screen stacks (leading/fill default) the extra spacer is invisible.
// Returns { row, label } so callers can tweak the text or append fixed spacers.
function addTextRow(parent, text, options) {
  const align = options.alignRight ? "right" : options.alignLeft ? "left" : "center";
  const row = parent.addStack();
  row.layoutHorizontally();
  if (align !== "left") row.addSpacer();
  const label = row.addText(text);
  label.font = options.font;
  if (options.color != null) label.textColor = options.color;
  if (align === "center") {
    label.centerAlignText();
    row.addSpacer();
  } else if (align === "right") {
    label.rightAlignText();
  } else {
    label.leftAlignText();
    if (options.stretch) row.addSpacer();
  }
  return { row, label };
}

// Bold yellow label (e.g. "Inflow", "Leftover"); centered unless alignLeft is set
function addCaption(parent, text, size, alignLeft, stretch) {
  return addTextRow(parent, text, {
    font: boldFont(size),
    color: brandYellow,
    alignLeft,
    stretch
  });
}

// Bold monetary value; colored by sign unless a color override is given.
// Centered unless alignLeft or alignRight is set. A minWidth (points) reserves
// fixed room for the row so the column width stays stable across amounts. In
// the medium layout every amount is left-padded to the same character count,
// so the lines are equal length and, in a monospace font, end on the same
// right edge: the values right-justify and the cents line up without
// estimating glyph widths. The small layout right-aligns instead, which lines
// up the cents since every amount shares a two-digit fraction.
function addAmount(parent, value, opts = {}) {
  // Left-aligned rows pad every amount to the widest figure's length so the
  // lines come out equal length and, in a monospace font, end on the same
  // right edge (see metricColumnWidth).
  const text = opts.alignLeft && opts.minWidth
    ? formatMoney(value).padStart(MAX_MONEY.length)
    : formatMoney(value);
  const { row, label } = addTextRow(parent, text, {
    font: monoBoldFont(opts.size),
    color: opts.color || (value < 0 ? lossRed : brandGreen),
    alignLeft: opts.alignLeft,
    alignRight: opts.alignRight
  });
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.5;
  if (opts.minWidth) {
    const extra = opts.minWidth - textWidth(text, opts.size);
    if (extra > 0) row.addSpacer(extra);
  }
}

// extraLarge: Leftover amount plus Inflow / Outflow detail lines. Leftover is
// rendered separately by addBreakdownSection, so only the other rows go here.
function addBreakdown(mainStack, data, detailFont) {
  METRICS.filter((metric) => metric.id !== "leftover")
    .forEach((metric) => addDetailRow(mainStack, metric.label, metric.value(data), detailFont));
}

// Left-aligned label, right-aligned value on one line
function addDetailRow(mainStack, label, value, detailFont) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  const labelText = row.addText(label);
  labelText.font = font(detailFont);
  labelText.textColor = regularColor;
  labelText.textOpacity = 0.6;
  row.addSpacer(INLINE_GAP);
  const valueText = row.addText(formatMoney(value));
  valueText.font = monoFont(detailFont);
  valueText.lineLimit = 1;
  valueText.minimumScaleFactor = 0.5;
  valueText.textColor = regularColor;
  valueText.rightAlignText();
}
