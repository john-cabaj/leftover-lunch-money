/*******************************************************************************
 *                                                                             *
 *   LUNCH MONEY WIDGET — a Scriptable home-screen widget.                    *
 *                                                                             *
 *   Pulls the current budget period’s totals and unreviewed transactions      *
 *   or, with the “previous” widget parameter, the prior period — from the     *
 *   Lunch Money API, computes the period leftover, and renders it as a        *
 *   family-specific layout (small / medium / large / extraLarge).             *
 *                                                                             *
 *   Layout rules of the road:                                                 *
 *     - Every size/measurement used to lay anything out is a named constant   *
 *       up front, so tweaks stay in one place and translate to Scriptable's   *
 *       point-based coordinates.                                              *
 *     - Row budgets are derived from the device's real widget container size  *
 *       (see widgetSizes) so lists never overflow the bottom edge.            *
 *     - Every tap anywhere on the widget opens the Lunch Money transactions    *
 *       view via a widget-level URL; layouts set no per-region tap targets.    *
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
//   LOSS_RED    — a negative leftover
const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

// Monospace typography for a terminal feel. Every figure is set in Menlo so
// all digits share one advance width — which is what makes amounts right-
// adjust and line up. White is the default text color.
const FONT_NAME = "Menlo";
const FONT_BOLD = "Menlo-Bold";
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

// Tapping anywhere on the widget opens the Lunch Money transactions view,
// regardless of which period the widget displays or which region is touched
const TRANSACTIONS_URL = "lunchmoney://transactions";

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

// Approximate line height for a given font size. Menlo's line box is tight
// (≈1.15× the point size), so this deliberately under-reserves the height the
// layout actually needs, letting the row budgets fit the last row.
function lineHeight(size) { return Math.ceil(size * 1.15); }

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
// Height budget per layout. review keeps +2pt slack so the last row isn't
// clipped on the taller (~170pt) medium widgets.
const WIDGET_HEIGHTS = { review: WIDGET_SIZE.medium + 2, overview: WIDGET_SIZE.large };
const PADDING_Y = 28;      // setPadding(14, 10, 14, 10)
const TOP_PAD = 14;        // default top inset; small drops to topPad below
const STACK_SPACING = 2;   // mainStack.spacing

// Gaps the render inserts between the header and the body, and inside the
// overview body. Shared by BOTH renderWidget/addOverview (where the spacer is
// rendered) and listHeightBudget (which subtracts the same points to fit list
// rows), so a gap tweak always lands in both places together.
const REVIEW_GAP = 2;      // review: header → metrics/list split
const OVERVIEW_GAP = 6;    // overview + breakdownLayout: header → body
const LIST_BODY_GAP = 10;  // overview: metric row → "Unreviewed" caption

// Sizes of the two header rows (LUNCH MONEY title and the period label beneath
// it); HEADER_H reserves exactly their combined height. The title renders with
// Font.boldSystemFont(TITLE_SIZE) and the period with font(PERIOD_SIZE).
const TITLE_SIZE = 12;
const PERIOD_SIZE = 11;
const HEADER_H = lineHeight(TITLE_SIZE) + STACK_SPACING + lineHeight(PERIOD_SIZE);

// Total vertical space a layout's header occupies: the fixed HEADER_H plus any
// per-layout headerPad pushed in above the title. The pad doesn't push the body
// down (the trailing flexible spacer absorbs it), but the row budgets still
// account for it so list rows never cross the widget's bottom edge.
function headerHeight(config) {
  return HEADER_H + (config.headerPad || 0);
}

// Inner content width for the medium widget: container width minus the 10pt
// side padding. The widget build reads it while computing the payee budget
// and the review split.
const MEDIUM_INNER_WIDTH = WIDGET_SIZE.width - 20;

// Medium review split: the metrics column keeps the smaller share so the
// unreviewed list gets the rest (31% / 69% of the inner width).
const METRICS_WEIGHT = 31;
const LIST_WEIGHT = 69;

// --------------------------------------------------------------------------
// Per-widget-family styling
// --------------------------------------------------------------------------

// small and the in-app preview share a layout; the amount font is derived
// rather than fixed: the largest size where MAX_MONEY ("$99,999.00") still
// fits the inner width AND the three caption+amount rows fit the widget height.
const SMALL_CAPTION = 10;
function smallAmountFont() {
  const innerWidth = WIDGET_SIZE.width - 20; // 10pt side padding each edge
  const byWidth = Math.floor(innerWidth / (0.6 * MAX_MONEY.length));
  // Height left for the three amount rows after padding, title, gaps, and the
  // three captions; 2pt slack keeps the final row from clipping.
  const rowBudget = WIDGET_SIZE.small - PADDING_Y - lineHeight(TITLE_SIZE)
    - STACK_SPACING - 3 * lineHeight(SMALL_CAPTION) - 2;
  const byHeight = Math.floor(rowBudget / (3 * 1.15));
  return Math.min(byWidth, byHeight);
}

const smallLayout = { layout: "stacked", caption: SMALL_CAPTION, amount: smallAmountFont(), topPad: 10 };
const FAMILY_LAYOUTS = {
  small:      smallLayout,
  // medium: a 2pt push-in above the title; the review gap pulls back to REVIEW_GAP
  // to compensate, so the list keeps its 6th row on every device
  medium:     { layout: "review", caption: 13, amount: 30, detailFont: 11, payeeLen: 28, headerPad: 2 },
  large:      { layout: "overview", caption: 14, amount: 30, detailFont: 12, payeeLen: 30 },
  extraLarge: { layout: "breakdown", caption: 15, amount: 46, detailFont: 11 },
  undefined:  smallLayout
};

/****************************************************
             SETUP - runs every time the widget loads
*****************************************************/

// Boot sequence: pull the API key, build the widget, then hand it to Scriptable
const LM_ACCESS_TOKEN = await getApiKey();
const widget = await getWidget();

Script.setWidget(widget);
Script.complete();

/****************************************************
             WIDGET
*****************************************************/

// Builds the complete widget; drops an inline error state when data can't load
async function getWidget() {
  const widget = new ListWidget();
  widget.title = "Lunch Money";

  const widgetFamily = config.widgetFamily;
  const layoutConfig = FAMILY_LAYOUTS[widgetFamily] || FAMILY_LAYOUTS.undefined;
  widget.setPadding(layoutConfig.topPad || TOP_PAD, 10, 14, 10);
  widget.backgroundGradient = getLinearGradient(COLORS.bg1, COLORS.bg2);

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

  // Render the chosen family layout into a vertical stack; every tap opens the
  // Lunch Money transactions view
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = STACK_SPACING;
  widget.url = TRANSACTIONS_URL;
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
  if (fresh) return fresh;

  const data = await lunchMoneyLeftoverInfo();

  if (data) {
    writeCache(data);
    return data;
  }

  // no connection: fall back to stale cache
  return readCache(true);
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
    const settings = await sendLunchMoneyRequest(`${BASE_URL}/budgets/settings`);
    // Prefer the configured budget period; fall back to the calendar month.
    // "previous" shows the prior period instead of the current one
    const range = getPeriodRange(settings, SHOW_PREVIOUS_PERIOD);
    const params = { ...range, include_totals: true, include_rollover_pool: true };
    const [summary, categories, unreviewed] = await Promise.all([
      sendLunchMoneyRequest(`${BASE_URL}/summary`, params),
      sendLunchMoneyRequest(`${BASE_URL}/categories`),
      fetchUnreviewedTransactions(range)
    ]);
    return {
      ...computeLeftover(summary, categories),
      periodLabel: periodLabelFor(settings, range),
      unreviewed: unreviewed.rows,
      unreviewedStatus: unreviewed.status
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Recent transactions awaiting review in the period, newest first. Filters
// client-side so both v1 ("uncleared") and v2 ("unreviewed") statuses are
// recognized. Returns a status so the layout can tell an empty list (nothing
// to review) apart from a failed fetch (nothing known about the list).
async function fetchUnreviewedTransactions(range) {
  try {
    const data = await sendLunchMoneyRequest(`${BASE_URL}/transactions`, {
      ...range,
      status: "unreviewed",
      include_pending: true
    });
    const raw = (data && data.transactions) || [];
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

// GET request with the API key as a Bearer token; URL-encodes query params
function sendLunchMoneyRequest(url, params = {}) {
  const headers = {
    'Authorization': LM_ACCESS_TOKEN.includes("Bearer") ? LM_ACCESS_TOKEN : `Bearer ${LM_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const request = new Request(url + buildQueryString(params));
  request.headers = headers;
  request.method = 'GET';
  return request.loadJSON();
}

// "?key=value&..." query suffix, or "" when there are no params
function buildQueryString(params) {
  const entries = Object.entries(params || {});
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
      isGroup: !!category.is_group,
      groupId: category.group_id != null ? category.group_id : null
    };
    names[category.id] = category.name;
    if (Array.isArray(category.children)) category.children.forEach(add);
  };
  (categories.categories || []).forEach(add);
  return { info, names };
}

// Which categories carry budgets at the group level versus in their children,
// so rows that merely mirror an already-budgeted parent/child stay out of the
// sum (see shouldCountEntry)
function budgetGrouping(entries, info) {
  const groupedBudgeted = {};
  const groupHasBudgetedChildren = {};
  for (const entry of entries) {
    const c = info[entry.category_id] || {};
    if (c.isGroup && entry.totals.budgeted != null) {
      groupedBudgeted[entry.category_id] = true;
    } else if (c.groupId != null && entry.totals.budgeted != null) {
      groupHasBudgetedChildren[c.groupId] = true;
    }
  }
  return { groupedBudgeted, groupHasBudgetedChildren };
}

// Shapes one summary entry into a clean budget row { name, initialBudget,
// activity, rollover, available, contribution }. The contribution is derived
// from the same figure the row already computes.
function shapeBudgetRow(entry, info, names) {
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

// Expands summary rows into per-category budget/activity data, applying group
// rules so groups and their children are never both counted
function categoryRows(summary, categories) {
  const { info, names } = indexCategories(categories);

  // Start from every non-income entry
  const entries = (summary.categories || []).filter((entry) => !(info[entry.category_id] || {}).isIncome);

  // Track which groups and which children hold budgets, to avoid double counting
  const { groupedBudgeted, groupHasBudgetedChildren } = budgetGrouping(entries, info);

  // Drop double-counted rows, then shape each survivor into a clean row object
  return entries
    .filter((entry) => shouldCountEntry(entry, info[entry.category_id] || {}, groupedBudgeted, groupHasBudgetedChildren))
    .map((entry) => shapeBudgetRow(entry, info[entry.category_id] || {}, names));
}

// A child row counts only when its group's budget is actually held at the
// group level; a group row counts only when it carries its own budget and no
// children do
function shouldCountEntry(entry, info, groupedBudgeted, groupHasBudgetedChildren) {
  if (info.groupId != null) {
    return !(groupedBudgeted[info.groupId] && !groupHasBudgetedChildren[info.groupId]);
  }
  if (info.isGroup) {
    if (entry.totals.budgeted == null) return false;
    if (groupHasBudgetedChildren[entry.category_id]) return false;
  }
  return true;
}

// Money in this period minus what we're on the hook to spend in it
function computeLeftover(summary, categories) {
  if (!summary || !Array.isArray(summary.categories)) {
    return null;
  }

  const inflow = Math.abs(totalFromBreakdown(summary.totals && summary.totals.inflow));
  const outflow = categoryRows(summary, categories).reduce((sum, row) => sum + row.contribution, 0);

  return {
    inflow,
    outflow,
    savings: inflow - outflow
  };
}

// Inflow is the sum of the summary's inflow breakdown fields
function totalFromBreakdown(breakdown) {
  if (!breakdown) return 0;
  return ["other_activity", "recurring_activity", "recurring_remaining", "uncategorized"]
    .reduce((total, key) => total + Math.abs(breakdown[key] || 0), 0);
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

// Menlo is monospace: advance width ≈ 0.6em, so glyph-count × 0.6 × size
function textWidth(str, size) {
  return String(str).length * 0.6 * size;
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

// Top-level renderer: picks stacked / review / overview / breakdown layouts
function renderWidget(mainStack, data, config) {
  switch (config.layout) {
    case "stacked":
      addBrandTitle(mainStack);
      addStackedMetrics(mainStack, data, config);
      break;
    case "review":
      withHeaderAndSpacer(mainStack, data, config, REVIEW_GAP, addReviewSplit);
      break;
    case "overview":
      withHeaderAndSpacer(mainStack, data, config, OVERVIEW_GAP, addOverview);
      break;
    default: // breakdown / extraLarge
      addBreakdownLayout(mainStack, data, config);
      break;
  }
}

// Header on top, a fixed gap, a body section, and a trailing flexible spacer —
// the shape shared by the review and overview layouts
function withHeaderAndSpacer(mainStack, data, config, gap, body) {
  addHeader(mainStack, data, config);
  mainStack.addSpacer(gap);
  body(mainStack, data, config);
  mainStack.addSpacer();
}

// extraLarge: Leftover summary plus Inflow / Outflow detail lines
function addBreakdownLayout(mainStack, data, config) {
  addHeader(mainStack, data, config);
  mainStack.addSpacer(OVERVIEW_GAP);
  const budget = mainStack.addStack();
  budget.layoutVertically();
  addCaption(budget, "Leftover", config.caption);
  addAmount(budget, data.savings, { size: config.amount });
  budget.addSpacer(LIST_BODY_GAP);
  addBreakdown(budget, data, config.detailFont);
  mainStack.addSpacer();
}

// Inflow / Outflow / Leftover stacked vertically (small, in-app preview).
// Labels hug the left edge while the monetary amounts right-justify, so the
// cents line up across rows. The stack fills the whole widget.
function addStackedMetrics(parent, data, config) {
  const stack = parent.addStack();
  stack.layoutVertically();
  stack.layoutWeight = 1;
  stack.topAlignContent();
  addMetrics(stack, data, config, { amountSize: config.amount, alignRight: true, captionLeft: true });
}

// Brand title row for the small stacked widget and the large headers
function addBrandTitle(parent) {
  addCenteredText(parent, "LUNCH MONEY", {
    font: Font.boldSystemFont(TITLE_SIZE),
    color: brandGreen
  });
}

// Inflow / Leftover / Outflow across the width as three equal columns that scale
function addMetricRow(parent, data, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  // Column order varies from the METRICS table: in this split layout Leftover
  // sits between Inflow and Outflow
  for (const id of ["inflow", "leftover", "outflow"]) {
    addMetricColumn(row, getMetric(id), data, config);
  }
}

// One metric column; layoutWeight divides the row equally so it scales across sizes
function addMetricColumn(parentRow, metric, data, config) {
  const col = parentRow.addStack();
  col.layoutVertically();
  col.layoutWeight = 1;
  col.spacing = 2;
  addCaption(col, metric.label, config.caption);
  // Leftover colors by sign (no color set), other metrics stay white
  addAmount(col, metric.value(data), { size: config.amount, color: metric.color });
}

// Large layout: metric columns across the width plus the unreviewed list below
function addOverview(mainStack, data, config) {
  addMetricRow(mainStack, data, config);
  mainStack.addSpacer(LIST_BODY_GAP);
  addCaption(mainStack, "Unreviewed", config.caption);
  const list = mainStack.addStack();
  list.layoutVertically();
  list.layoutWeight = 1;
  addUnreviewedItems(list, data, config);
}

// Medium layout: metrics top-aligned on the left, unreviewed transactions on the right
function addReviewSplit(mainStack, data, config) {
  const row = mainStack.addStack();
  row.layoutHorizontally();

  const left = row.addStack();
  left.layoutVertically();
  left.layoutWeight = METRICS_WEIGHT;
  addMetrics(left, data, config, { amountSize: config.amount, alignLeft: true });
  left.addSpacer();
  left.addSpacer(LIST_BODY_GAP);

  const right = row.addStack();
  right.layoutVertically();
  right.layoutWeight = LIST_WEIGHT;
  addCaption(right, "Unreviewed", config.caption, true);
  addUnreviewedItems(right, data, config);
  right.addSpacer();
}

// Inflow / Outflow / Leftover rows, sharing one badge + amount style.
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
// plausible figure at the row's size, plus the 24pt gap that separates the
// right-justified amounts from the unreviewed list. Keeping it a pure function
// of the font size means the list position (and the margin on every row)
// never shifts with the amounts or the list content.
function metricColumnWidth(size, alignLeft) {
  if (!alignLeft) return undefined;
  return textWidth(MAX_MONEY, size) + 24;
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
function listHeightBudget(config) {
  const height = WIDGET_HEIGHTS[config.layout];
  if (config.layout === "review") {
    // medium: list shares the row's fixed height with the metrics column
    return height - PADDING_Y - headerHeight(config) - REVIEW_GAP - lineHeight(config.caption);
  }
  if (config.layout === "overview") {
    const metricRowH = lineHeight(config.caption) + STACK_SPACING + lineHeight(config.amount);
    return height - PADDING_Y - headerHeight(config) - OVERVIEW_GAP - metricRowH - LIST_BODY_GAP - lineHeight(config.caption);
  }
  return 0;
}

// One transaction row: text line plus the trailing 1pt spacer between rows
function rowFitHeight(config) {
  return lineHeight(config.detailFont || 9) + 1;
}

// How many rows fit: the budget divided by the row pitch. The trailing
// flexible spacer absorbs whatever's left, so rows can run right up to the
// widget's bottom edge.
function maxUnreviewedCount(data, config) {
  const items = data.unreviewed || [];
  if (items.length === 0) return 0;
  const count = Math.max(1, Math.floor(listHeightBudget(config) / rowFitHeight(config)));
  return Math.min(items.length, count);
}

// Unreviewed section fallback: a plain "nothing to review" notice matching the
// transaction-row font, or a "couldn't load" hint one size smaller when the
// fetch failed.
function addUnreviewedEmpty(parent, status, config) {
  const failed = status === "failed";
  const text = failed ? "Couldn't load unreviewed" : "No unreviewed transactions";
  const empty = parent.addText(text);
  empty.font = font(failed ? Math.max(7, (config.detailFont || 9) - 2) : (config.detailFont || 9));
  empty.textColor = regularColor;
  empty.textOpacity = failed ? 0.8 : 0.6;
  empty.lineLimit = 3;
  empty.minimumScaleFactor = 0.6;
}

// One unreviewed transaction: payee + amount on a single line (no date)
function addTransactionRow(parent, t, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  const fontSize = config.detailFont || 9;
  // In the medium (review) list the payee is capped by row width so a long
  // name truncates with "…" instead of running into its amount; other layouts
  // keep the fixed character cap.
  const maxPayee = config.layout === "review" ? mediumPayeeBudget(config) : (config.payeeLen || 16);
  const payee = row.addText(clip(t.payee, maxPayee));
  payee.font = font(fontSize);
  payee.textColor = regularColor;
  payee.lineLimit = 1;
  row.addSpacer();
  // Lunch Money stores expenses as positive and income as negative; expenses
  // get a "-" in red, income a "+" in regular green
  const isInflow = t.amount < 0;
  const amount = row.addText((isInflow ? "+" : "-") + formatMoney(Math.abs(t.amount)));
  amount.font = font(fontSize);
  amount.lineLimit = 1;
  amount.textColor = isInflow ? incomeGreen : expenseRed;

  parent.addSpacer(1);
}

// Max payee characters in the medium (review) list so a name truncates with
// "…" while always leaving room for a fixed gap and the widest signed amount
// on the same line — the payee can then never reach its own amount. Measured
// against the list column's real width (its share of the inner width), not the
// whole widget, so long names use the space the layout actually gives them.
function mediumPayeeBudget(config) {
  const fs = config.detailFont || 9;
  const amountW = textWidth(MAX_SIGNED_MONEY, fs);
  const listW = (MEDIUM_INNER_WIDTH * LIST_WEIGHT) / (METRICS_WEIGHT + LIST_WEIGHT);
  const room = Math.max(0, listW - 8 - amountW);
  return Math.max(4, Math.floor(room / (0.6 * fs)));
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
  addBrandTitle(mainStack);
  addCenteredText(mainStack, budgetPeriodLabel(data), {
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
// flex spacer. Returns { row, label } so callers can tweak the text or append
// fixed spacers afterwards.
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
  }
  return { row, label };
}

// Yellow label (e.g. "Inflow", "Leftover"); centered unless alignLeft is set
function addCaption(parent, text, size, alignLeft) {
  addTextRow(parent, text, {
    font: font(size),
    color: brandYellow,
    alignLeft
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
  let text = formatMoney(value);
  if (opts.alignLeft && opts.minWidth) {
    text = text.padStart(MAX_MONEY.length);
  }
  const { row, label } = addTextRow(parent, text, {
    font: boldFont(opts.size),
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

// extraLarge: Leftover amount plus Inflow / Outflow detail lines
function addBreakdown(mainStack, data, detailFont) {
  for (const metric of METRICS) {
    if (metric.id === "leftover") continue;
    addDetailRow(mainStack, metric.label, metric.value(data), detailFont);
  }
}

// Left-aligned label, right-aligned value on one line
function addDetailRow(mainStack, label, value, detailFont) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  const labelText = row.addText(label);
  labelText.font = font(detailFont || 9);
  labelText.textColor = regularColor;
  labelText.textOpacity = 0.6;
  row.addSpacer(8);
  const valueText = row.addText(formatMoney(value));
  valueText.font = font(detailFont || 9);
  valueText.lineLimit = 1;
  valueText.minimumScaleFactor = 0.5;
  valueText.textColor = regularColor;
  valueText.rightAlignText();
}