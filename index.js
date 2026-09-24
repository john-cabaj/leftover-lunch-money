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
 *       metrics with the same line. Tapping opens the UNFILTERED (no date     *
 *       filter) delete_pending transactions page — all of them, regardless    *
 *       of period.                                                            *
 *                                                                             *
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
const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

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
const METRICS = [
  { id: "inflow",   label: "Inflow",   value: (d) => Math.abs(d.inflow), color: regularColor },
  { id: "outflow",  label: "Outflow",  value: (d) => d.outflow,         color: regularColor },
  { id: "leftover", label: "Leftover", value: (d) => d.savings,         color: undefined }
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

// Tap targets (web versions of the Lunch Money app deep links): the widget-wide
// default opens the transactions list; the metrics and unreviewed regions
// override it with their own targets. Budget deep-links by the displayed
// period's start date, and the transactions views pin the same period with a
// time=custom range and include pending transactions.
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

// Shared builder: /transactions/YYYY/MM pinned to the displayed period
function transactionPageUrl(data, filters) {
  const p = periodPathParts(data);
  const path = p.year ? `/transactions/${p.year}/${p.month}` : "/transactions";
  return appDeepLink(WEB_APP_URL + path + buildQueryString({ ...periodParams(data), ...filters }));
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
// period-independent, so the target skips the period path and time=custom
// range the period-spanning taps pin; time=all is how the web app expresses
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

// BASE_FILE: folder (under Scriptable's Documents dir) for cache + diagnostics;
// API_KEY: the Keychain entry holding the API token;
// CACHE_KEY + CACHED_MS: cache file name and how long a fresh copy stays usable.
// The cache is split by period so a "previous" request never serves the current
// period's cached data (or vice versa).
const BASE_FILE = 'LunchMoneyWidget';
const API_KEY = "lunchMoneyApiKey";
const CACHE_KEY = SHOW_PREVIOUS_PERIOD ? "lunchMoneyCache_previous" : "lunchMoneyCache";
const CACHED_MS = 600000; // 10 minutes

// v2 renamed "uncleared" to "unreviewed"; match either so accounts mid-migration work
const UNREVIEWED_STATUSES = ["unreviewed", "uncleared"];

// Month names for the header label
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// --------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------

// Real rendered line heights read from Scriptable's font metrics, so row
// budgets match how text actually lays out. The old text-height heuristic
// under-measured Avenir, so a full list overflowed the widget and Scriptable
// pushes excess content off the TOP of the widget — clipping the LUNCH MONEY
// title. Budgets now measure each family's actual line height; the fallback
// factors keep running on runtimes without Font.lineHeight. LINE_HEIGHT_FACTOR
// (≈1.15×) is Menlo's tight line box, used by the small widget's amount fit.
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
// share the caption's visual left edge. Applied to the lock-screen accessory's
// transaction rows (addTransactionRow).
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
// (addStackedMetrics) instead of the retired "!" glyph.
const BADGE_PENDING_LABEL = "Deleted Transactions Pending!";
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

function headerBlockHeight(config) {
  return lineHeight(TITLE_SIZE) + headerBlockGap(config) + lineHeight(PERIOD_SIZE);
}

// Total vertical space a layout's header occupies: the fixed header block height
// plus any per-layout headerPad pushed in above the title. The pad doesn't push
// the body down (the trailing flexible spacer absorbs it), but the row budgets
// still account for it so list rows never cross the widget's bottom edge. The
// Delete Pending badge lives in the unreviewed list column, not the header, so
// it is reserved by listHeightBudget instead (deletePendingBadgeHeight).
function headerHeight(config) {
  return headerBlockHeight(config) + (config.headerPad || 0);
}

// Vertical space the Delete Pending badge occupies at the top of the
// unreviewed list column: one caption-weighted line above the caption, plus
// LIST_BOTTOM_SLACK breathing room so the list never sits flush against the
// widget's height limit while the badge is up (a flush list can clip the top
// of the widget, and the review layout already builds the same 2pt slack into
// WIDGET_HEIGHTS). Only layouts that render an unreviewed list under a caption
// reserve it (review / overview / accessoryRectangular — the rectangular
// lock-screen accessory, whose list fits by the same budget); the small stacked
// widget's badge line sits in the widget's on-device slack above the metrics
// instead and reserves nothing, and layouts without an unreviewed list never
// show the badge. Zero when no transactions await deletion
// so fitted row counts only shrink when the badge actually shows.
// The badge line itself is reserved at the LEAN box (like the review header and
// caption): WidgetKit layers text tighter than Font.lineHeight, so reserving
// the full measured line under-couns and wastes part of a row while the badge
// is up. Nothing about the badge's own fit is at risk — the label is short,
// one line, and never near the width edge or the top clip zone.
const LIST_BOTTOM_SLACK = 2; // guaranteed gap under the last row / badge line
function deletePendingBadgeHeight(data, config) {
  if (!data || !config || (data.deletePendingCount || 0) <= 0) return 0;
  if (config.layout !== "review" && config.layout !== "overview" && config.layout !== "accessoryRectangular") return 0;
  return leanLineHeight(config.caption) + LIST_BOTTOM_SLACK;
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

// The deep-link to present for this run, or "" when it boots. Scriptable can
// inject URL-scheme arguments a tick after a cold start; the one-beat wait
// (nextTick) stops a late-arriving tap from being misread as a boot, and gives
// a cold-launched WebView presentation a settled UI to present from.
async function resolveTap() {
  if (config.runsInWidget) return "";
  await nextTick();
  const target = tappedTarget();
  if (target) return target;
  if (cameFromTap()) {
    writeDiagnostics("tap ran without a url argument; opening the fallback transactions view");
    return fallbackTapUrl();
  }
  return "";
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

const tapTarget = await resolveTap();
if (tapTarget) {
  await presentWebPage(tapTarget);
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
    writeDiagnostics("tap fallback: transactions for " + range.start_date + ".." + range.end_date);
    return transactionsTapUrl({ periodStart: range.start_date, periodEnd: range.end_date });
  } catch (e) {
    writeDiagnostics("tap fallback period lookup failed: " + e);
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
// the page stays on screen until then. A load error is logged, and a failed
// presentation falls back to Safari so the tap still lands.
async function presentWebPage(url) {
  try {
    const webView = new WebView();
    webView.loadURL(url).catch((e) => writeDiagnostics("tap webview load failed: " + e));
    await webView.present(true);
  } catch (e) {
    writeDiagnostics("tap webview present failed: " + e);
    Safari.open(url);
  }
}

/****************************************************
             WIDGET
*****************************************************/

// Builds the complete widget; drops an inline error state when data can't load
async function getWidget() {
  const widget = new ListWidget();
  widget.title = "Lunch Money";

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
  addCaption(widget, "Leftover", config.caption);
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

  const data = await lunchMoneyLeftoverInfo();

  if (data) {
    data.lastUpdated = Date.now();
    writeCache(data);
    return data;
  }

  // no connection: fall back to stale cache
  const stale = readCache(true);
  return stale ? stampCacheTime(stale) : null;
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

// Fetches the summary + categories for the selected budget period (current or
// previous, per the widget parameter), computes the leftover, and pulls the
// latest unreviewed transactions in the same range
async function lunchMoneyLeftoverInfo() {
  if (!LM_ACCESS_TOKEN) {
    return null;
  }
  try {
    const settings = await sendLunchMoneyRequest('/budgets/settings');
    // Prefer the configured budget period; fall back to the calendar month.
    // "previous" shows the prior period instead of the current one
    const range = getPeriodRange(settings, SHOW_PREVIOUS_PERIOD);
    // include_exclude_from_budgets keeps "exclude from budget" categories in the
    // summary: only income and "exclude from totals" categories drop out of
    // the leftover, so budget-excluded spending must still count as outflow.
    const params = { ...range, include_totals: true, include_rollover_pool: true, include_exclude_from_budgets: true };
    const [summary, categories, unreviewed, deletePending] = await Promise.all([
      sendLunchMoneyRequest('/summary', params),
      sendLunchMoneyRequest('/categories'),
      fetchUnreviewedTransactions(range),
      fetchDeletePendingTransactions(range)
    ]);
    return {
      ...computeLeftover(summary, categories),
      periodLabel: periodLabelFor(settings, range),
      periodStart: range.start_date,
      periodEnd: range.end_date,
      unreviewed: unreviewed.rows,
      unreviewedStatus: unreviewed.status,
      deletePendingCount: deletePending.count,
      deletePendingStatus: deletePending.status
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// The raw /transactions rows for one status within the range. Both status pulls
// below differ only in this call (delete_pending sends no include_pending), so
// the request shape lives here and the wrappers keep their own mapping + status
// semantics.
async function fetchTransactions(range, status, includePending = false) {
  const data = await sendLunchMoneyRequest('/transactions', {
    ...range,
    status,
    ...(includePending ? { include_pending: true } : {})
  });
  return (data && data.transactions) || [];
}

// Recent transactions awaiting review in the period, newest first. Filters
// client-side so both v1 ("uncleared") and v2 ("unreviewed") statuses are
// recognized. Returns a status so the layout can tell an empty list (nothing
// to review) apart from a failed fetch (nothing known about the list).
async function fetchUnreviewedTransactions(range) {
  try {
    const raw = await fetchTransactions(range, "unreviewed", true);
    const counts = {};
    raw.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
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
    writeDiagnostics(`unreviewed ${range.start_date}..${range.end_date} raw=${raw.length} statuses=${JSON.stringify(counts)} kept=${rows.length}`);
    return { rows, status: rows.length > 0 ? "ok" : "empty" };
  } catch (e) {
    writeDiagnostics("unreviewed request failed: " + e);
    return { rows: [], status: "failed" };
  }
}

// Transactions the synced account deleted after they were updated by the user;
// these need manual intervention. Returns a count so the layout can show the
// Delete Pending badge, and a status so a failed fetch can degrade to no badge.
async function fetchDeletePendingTransactions(range) {
  try {
    const raw = await fetchTransactions(range, "delete_pending");
    writeDiagnostics(`delete_pending ${range.start_date}..${range.end_date} count=${raw.length}`);
    return { count: raw.length, status: raw.length > 0 ? "ok" : "empty" };
  } catch (e) {
    writeDiagnostics("delete_pending request failed: " + e);
    return { count: 0, status: "failed" };
  }
}

// GET request against the Lunch Money API: path is relative to BASE_URL (e.g.
// "/summary"). Adds the API key as a Bearer token and URL-encodes query params.
function sendLunchMoneyRequest(path, params = {}) {
  const headers = {
    'Authorization': LM_ACCESS_TOKEN.includes("Bearer") ? LM_ACCESS_TOKEN : `Bearer ${LM_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const request = new Request(BASE_URL + path + buildQueryString(params));
  request.headers = headers;
  request.method = 'GET';
  return request.loadJSON();
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
// activity, rollover, available, contribution }. The category name comes from
// the indexed names map; the contribution is derived from the same figure the
// row already computes.
function shapeBudgetRow(entry, names) {
  const initialBudget = entry.totals.budgeted;
  const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
  const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
  const available = entry.totals.available != null
    ? entry.totals.available
    : (initialBudget != null ? initialBudget + rollover - activity : null);
  // Budgeted categories spend at most their budget; over-budget categories
  // spend the full original budget plus the overspend. Unbudgeted categories
  // spend their activity.
  const contribution = initialBudget == null
    ? activity
    : (available >= 0 ? initialBudget : initialBudget - available);
  return {
    name: names[entry.category_id] || entry.category_id,
    initialBudget,
    activity,
    rollover,
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
// non-budget spending still shrinks the leftover.
function computeLeftover(summary, categories) {
  if (!summary || !Array.isArray(summary.categories)) {
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
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  date.setFullYear(target.getFullYear());
  date.setMonth(target.getMonth());
  date.setDate(Math.min(day, lastDay));
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
    while (addBudgetPeriod(periodStart, settings, 1) <= target) {
      periodStart = addBudgetPeriod(periodStart, settings, 1);
    }
  }

  let periodEnd = addBudgetPeriod(periodStart, settings, 1);
  periodEnd.setDate(periodEnd.getDate() - 1);

  if (settings.budget_use_last_day_of_month && settings.budget_period_granularity === "month") {
    periodEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0);
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
    end_date: formatDateString(new Date(now.getFullYear(), now.getMonth() + 1 + monthOffset, 0))
  };
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

// Path helpers: the Scriptable folder used for cache + diagnostics, and the
// two files inside it
function widgetFolder() {
  return FileManager.local().documentsDirectory() + "/" + BASE_FILE;
}
function cachePath() { return widgetFolder() + "/" + CACHE_KEY; }
function diagnosticsPath() { return widgetFolder() + "/diagnostics.txt"; }

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

// Appends one timestamped line to LunchMoneyWidget/diagnostics.txt in the
// Scriptable folder, so diagnostics are readable from the Files app even when
// the in-app preview hides the console
function writeDiagnostics(line) {
  try {
    const fm = FileManager.local();
    ensureWidgetFolder();
    const path = diagnosticsPath();
    const prev = fm.fileExists(path) ? fm.readString(path) : "";
    fm.writeString(path, prev + new Date().toISOString() + " " + line + "\n");
  } catch (e) {
    // never block rendering on diagnostics
  }
}

// Persists the latest result to the cache file
function writeCache(data) {
  const fm = FileManager.local();
  ensureWidgetFolder();
  fm.writeString(cachePath(), JSON.stringify(data));
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
  addCaption(budget, "Leftover", config.caption);
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
// never fire). When synced transactions await a manual delete, the full red
// "Deleted Transactions Pending!" label — the same caption-weighted line the
// list layouts show — tops the metrics above the Inflow caption instead of the
// old single "!" that rode the Leftover amount row. It needs only
// leanLineHeight(caption) of the widget's real on-device slack (WidgetKit lays
// Avenir tighter than Font.lineHeight — the same slack the review layout
// reclaims for row counts), so no existing size or padding changes; a full
// caption-weight line also reads as the alert it is (a lone glyph was a
// razor-thin hit area, though on small no element is tappable anyway).
function addStackedMetrics(parent, data, config) {
  const stack = parent.addStack();
  stack.layoutVertically();
  stack.layoutWeight = 1;
  stack.topAlignContent();
  if (hasDeletePending(data)) addDeletePendingBadge(stack, data, config, { alignLeft: true });
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

// "Deleted Transactions Pending" label, shown once at the TOP of the
// unreviewed list column — above the "Unreviewed Transactions" caption —
// on review, overview, and rectangular-accessory layouts: exactly the
// caption's font and size (boldFont(config.caption)) in the palette's loss
// red, tappable to open EVERY transaction filtered to status=delete_pending —
// no date filter, so it shows all of them regardless of the widget's period. It
// never scales down (full caption size, like the caption itself), stays on one
// line — the label fits the narrowest list column (~188pt on the SE 1st-gen
// medium vs ≈186pt at 13pt, and ≈143pt at the rectangular accessory's 10pt
// caption vs a 145pt inner width), so it never needs the minScale the old
// design used. Reserves leanLineHeight(caption) + LIST_BOTTOM_SLACK via
// deletePendingBadgeHeight so the list loses part of one row while it's up and
// never runs flush against the widget's height limit (flush lists can clip the
// widget top). The label is NOT placed inside any stack that already carries a
// tap URL — the parent column stack drops the unreviewed URL so Scriptable's
// tap hit-testing resolves to the label's own URL (a parent stack's URL can
// shadow a child label's).
// Alignment mirrors the "Unreviewed Transactions" caption it sits above:
// centered on the large widget (addOverview), left-aligned on the medium
// (addReviewSplit) and the rectangular accessory (addAccessoryRectangular) via
// the same addTextRow alignment the caption uses. The accessory also stretches
// the badge row across the column (stretch), matching the caption and the
// transaction rows' flush-left edge under the lock screen's centering stack,
// and overrides the red with the standard label color (brandYellow) — lock
// screens color labels one way and amounts another, so the badge reads as a
// label there instead of as a loss amount.
function addDeletePendingBadge(parent, data, config, opts = {}) {
  const { row, label } = addTextRow(parent, BADGE_PENDING_LABEL, {
    font: boldFont(config.caption),
    color: opts.color || lossRed,
    alignLeft: opts.alignLeft,
    stretch: opts.stretch
  });
  label.lineLimit = 1;
  label.url = deletePendingTapUrl();
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
// (overview), and rectangular-accessory layouts: an optional Delete Pending
// badge above the "Unreviewed Transactions" caption, then the rows. On the home
// screens the caption row and the list stack both carry the unreviewed tap URL —
// the "limit the unreviewed tap target to the label + list rows" convention —
// while the badge's own delete-pending URL stays reachable because neither its
// parent column nor any ancestor stack sets a URL (a parent stack's url can
// shadow a child's). The lock-screen rectangular accessory keeps the whole
// column URL-free (tappable: false) so a tap anywhere on it can never shadow the
// badge target, and it passes the accessory's stretch + label-color options.
function addUnreviewedSection(parent, data, config, opts = {}) {
  if (hasDeletePending(data)) {
    addDeletePendingBadge(parent, data, config, opts);
  }
  const caption = addCaption(parent, "Unreviewed Transactions", config.caption, opts.alignLeft, opts.stretch);
  const list = parent.addStack();
  list.layoutVertically();
  if (opts.tappable !== false) {
    caption.row.url = unreviewedTapUrl(data);
    list.url = unreviewedTapUrl(data);
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
  addCaption(leftover, "Leftover", config.caption, true);
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
// every device — the config sizes replace the old per-render fit test.
// Centered on both axes: flexible spacers above and below do the vertical
// centering (layoutWeight is unreliable inside accessory widgets), and
// addCaption / addAmount each center their line horizontally.
function addAccessoryCircular(mainStack, data, config) {
  mainStack.addSpacer();
  addCaption(mainStack, "Leftover", config.caption);
  addAmount(mainStack, data.savings, { size: config.amount });
  mainStack.addSpacer();
}

// Lock-screen inline accessory (the single line above the clock): Scriptable
// forces its own system typeface, so this is just "Leftover <amount>" as plain
// text — not addAmount, which would try to use Menlo-Bold and re-center.
function addAccessoryInline(mainStack, data, config) {
  const label = mainStack.addText("Leftover " + formatMoney(data.savings));
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
    items.forEach((t) => addTransactionRow(parent, t, config));
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
    const header = leanLineHeight(TITLE_SIZE) + headerBlockGap(config)
      + leanLineHeight(PERIOD_SIZE) + (config.headerPad || 0);
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

// One unreviewed transaction: payee + amount on a single line (no date)
function addTransactionRow(parent, t, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  // The rectangular accessory's Menlo rows sit a hair left of the Avenir
  // captions/badge (the faces' left bearings differ), so they take a
  // MENLO_LEFT_INSET leading nudge to share the caption's visual left edge.
  if (config.layout === "accessoryRectangular") row.addSpacer(MENLO_LEFT_INSET);
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
  const room = Math.max(0, width - INLINE_GAP - textWidth(MAX_SIGNED_MONEY, fs));
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
