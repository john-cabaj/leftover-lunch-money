/****************************************************
             CONFIGURATION
*****************************************************/
// Widget background gradient (top and bottom colors)
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E'
};

// BRAND_GREEN: positive amounts / title; BRAND_YELLOW: captions/labels;
// LOSS_RED: negative leftover
const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

// Monospace typography for a terminal feel; white is the default text color
const FONT_NAME = "Menlo";
const FONT_BOLD = "Menlo-Bold";
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

// Reusable color objects so layout helpers don't rebuild them every frame
const brandGreen = new Color(BRAND_GREEN);
const brandYellow = new Color(BRAND_YELLOW);
const lossRed = new Color(LOSS_RED);
// iOS system green / red flags income (+) vs expenses (-) in a transaction row
const incomeGreen = new Color('#34C759');
const expenseRed = new Color('#FF3B30');

// Font factories so every stack shares the same typography
function font(size) { return new Font(FONT_NAME, size); }
function boldFont(size) { return new Font(FONT_BOLD, size); }

// Lunch Money API base URL
const BASE_URL = 'https://api.lunchmoney.dev/v2';

// Tap targets: the default (widget) opens the transactions list; the metrics
// and unreviewed regions override it with their own targets
const BUDGET_URL = "lunchmoney://budget";
const UNREVIEWED_URL = "lunchmoney://transactions?status=unreviewed&include_pending=true";
const DEFAULT_URL = "lunchmoney://transactions";

// BASE_FILE: folder for cached data; API_KEY: Keychain entry for the API token;
// CACHE_KEY + CACHED_MS: cache file name and how long a fresh copy stays usable
const BASE_FILE = 'LunchMoneyWidget';
const API_KEY = "lunchMoneyApiKey";
const CACHE_KEY = "lunchMoneyCache";
const CACHED_MS = 600000; // 10 minutes

// v2 renamed "uncleared" to "unreviewed"; match either so accounts mid-migration work
const UNREVIEWED_STATUSES = ["unreviewed", "uncleared"];

// Month names for the header label
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Setting a widget parameter switches the header to "CURRENT PAY CYCLE"
const USE_PAY_CYCLE = args.widgetParameter != null;

// Per-widget-family styling. small and the in-app preview share a layout.
const smallLayout = { layout: "stacked", caption: 10, inflowAmount: 17, leftoverAmount: 19 };
const FAMILY_LAYOUTS = {
  small:      smallLayout,
  medium:     { layout: "review", header: true, caption: 13, amount: 26, leftoverAmount: 30, detailFont: 11, payeeLen: 28 },
  large:      { layout: "overview", header: true, caption: 14, amount: 30, detailFont: 12, payeeLen: 30 },
  extraLarge: { layout: "breakdown", header: true, caption: 15, amount: 46, detailFont: 11 },
  undefined:  smallLayout
};

// Approximate line height for a given font size, matching Menlo's metrics
function lineHeight(size) { return Math.ceil(size * 1.25); }

// Height reserved by the widget's fixed padding, header, and per-layout chrome.
// Declared up here (before SETUP runs) so height math can use them safely.
// review: 172 (not 155) so five unreviewed rows fit on taller (~170pt) medium widgets.
const WIDGET_HEIGHTS = { review: 172, overview: 345 };
const PADDING_Y = 28; // setPadding(14, 10, 14, 10)
const STACK_SPACING = 2; // mainStack.spacing
const HEADER_H = lineHeight(12) + STACK_SPACING + lineHeight(11); // title + period

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
  widget.setPadding(14, 10, 14, 10);
  widget.backgroundGradient = getLinearGradient(COLORS.bg1, COLORS.bg2);

  const widgetFamily = config.widgetFamily;

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
    addErrorState(widget, errorMessage);
    return widget;
  }

  // Render the chosen family layout into a vertical stack; anything not
  // assigned a specific tap target falls through to the transactions view
  const layoutConfig = FAMILY_LAYOUTS[widgetFamily] || FAMILY_LAYOUTS.undefined;
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  widget.url = layoutConfig.layout === "stacked" ? BUDGET_URL : DEFAULT_URL;
  renderWidget(mainStack, lunchMoneyData, layoutConfig);

  return widget;
};

// "Leftover" caption plus the given error message, centered
function addErrorState(widget, message) {
  addCaption(widget, "Leftover", 11);
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
};

/****************************************************
             API
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

// Fetches the summary + categories for the current budget period, computes leftovers,
// and pulls the latest unreviewed transactions in the same range
async function lunchMoneyLeftoverInfo() {
  if (!LM_ACCESS_TOKEN) {
    return null;
  }
  try {
    const settings = await sendLunchMoneyRequest(`${BASE_URL}/budgets/settings`);
    // Prefer the configured budget period; fall back to the calendar month
    const range = getCurrentBudgetPeriod(settings) || getCalendarMonthRange();
    const params = { ...range, include_totals: true, include_rollover_pool: true };
    const [summary, categories, unreviewed] = await Promise.all([
      sendLunchMoneyRequest(`${BASE_URL}/summary`, params),
      sendLunchMoneyRequest(`${BASE_URL}/categories`),
      fetchUnreviewedTransactions(range)
    ]);
    return {
      ...computeLeftover(summary, categories),
      unreviewed: unreviewed.rows,
      unreviewedDiag: unreviewed.diag
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Recent transactions awaiting review in the period, newest first. Filters client-side
// so both v1 ("uncleared") and v2 ("unreviewed") statuses are recognized, and reports a
// status breakdown when nothing matches
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
    let diag = null;
    if (rows.length === 0) {
      const detail = Object.keys(counts).length
        ? Object.entries(counts).map(([k, n]) => `${k}:${n}`).join(", ")
        : "no transactions in period";
      diag = `no unreviewed (${detail})`;
    }
    return { rows, diag };
  } catch (e) {
    writeDiagnostics("unreviewed request failed: " + e);
    return { rows: [], diag: "request failed: " + e };
  }
}

// GET request with the API key as a Bearer token; URL-encodes query params
function sendLunchMoneyRequest(url, params = {}) {
  const headers = {
    'Authorization': LM_ACCESS_TOKEN.includes("Bearer") ? LM_ACCESS_TOKEN : `Bearer ${LM_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const query = Object.keys(params).length > 0
    ? '?' + Object.entries(params).map(([key, value]) => `${key}=${value}`).join('&')
    : '';
  const request = new Request(url + query);
  request.headers = headers;
  request.method = 'GET';
  return request.loadJSON();
}

/****************************************************
             Leftover Calculation
*****************************************************/

// Expands summary rows into per-category budget/activity data, applying group rules
function categoryRows(summary, categories) {
  const info = {};
  const names = {};
  // Index every category (recursively) by id for quick lookups later
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

  // Start from every non-income entry
  const rows = (summary.categories || []).filter((entry) => !(info[entry.category_id] || {}).isIncome);

  // Track which groups and which children have budgets, to avoid double counting
  const groupedBudgeted = {};
  const groupHasBudgetedChildren = {};
  for (const entry of rows) {
    const c = info[entry.category_id] || {};
    if (c.isGroup && entry.totals.budgeted != null) {
      groupedBudgeted[entry.category_id] = true;
    } else if (c.groupId != null && entry.totals.budgeted != null) {
      groupHasBudgetedChildren[c.groupId] = true;
    }
  }

  // Filter out double-counted rows, then shape each into a clean row object.
  // The contribution is derived from the same figure the row already computes.
  return rows
    .filter((entry) => shouldCountEntry(entry, info[entry.category_id] || {}, groupedBudgeted, groupHasBudgetedChildren))
    .map((entry) => {
      const initialBudget = entry.totals.budgeted;
      const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
      const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
      const available = entry.totals.available != null
        ? entry.totals.available
        : (initialBudget != null ? initialBudget + rollover - activity : null);
      // Budgeted categories spend at most their budget; over-budget categories spend the
      // full original budget plus the overspend. Unbudgeted categories spend their activity.
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
    });
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

// A child row counts only when its group's budget is actually held at the group level;
// a group row counts only when it carries its own budget and no children do
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

// Inflow is derived from the summary's inflow breakdown fields
function totalFromBreakdown(breakdown) {
  if (!breakdown) return 0;
  let total = 0;
  for (const key of ["other_activity", "recurring_activity", "recurring_remaining", "uncategorized"]) {
    total += Math.abs(breakdown[key] || 0);
  }
  return total;
}

/****************************************************
             Utilities
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

// Moves date by count budget periods using the account's period quantity + granularity
function addBudgetPeriod(date, settings, count) {
  const d = new Date(date.getTime());
  const quantity = settings.budget_period_quantity || 1;
  const granularity = settings.budget_period_granularity || "month";
  for (let i = 0; i < quantity * count; i++) {
    switch (granularity) {
      case "day":
        d.setDate(d.getDate() + 1);
        break;
      case "week":
        d.setDate(d.getDate() + 7);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + 1);
        if (d.getMonth() !== date.getMonth()) d.setDate(0);
        break;
      case "twice a month":
        d.setDate(d.getDate() + 15);
        break;
      default: // "month" and any unexpected value behave as months
        addMonthsClamped(d, 1);
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

// Walks the anchor date forward/backward until the period containing today is found
function getCurrentBudgetPeriod(settings) {
  if (!settings || !settings.budget_period_anchor_date) return null;
  const anchor = parseIsoDate(settings.budget_period_anchor_date);
  if (isNaN(anchor.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  anchor.setHours(0, 0, 0, 0);

  let periodStart = new Date(anchor.getTime());
  if (periodStart > today) {
    while (periodStart > today) {
      periodStart = addBudgetPeriod(periodStart, settings, -1);
    }
  } else {
    while (addBudgetPeriod(periodStart, settings, 1) <= today) {
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

// Fallback range when the account has no custom budget period
function getCalendarMonthRange() {
  const now = new Date();
  return {
    start_date: formatDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    end_date: formatDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

/****************************************************
             Storage
*****************************************************/

// Full path to the Scriptable folder used for cache + diagnostics
function storageFolder() {
  return FileManager.local().documentsDirectory() + "/" + BASE_FILE;
}

// Reads the cached result JSON; TTL-gated unless allowStale is set (offline fallback)
function readCache(allowStale) {
  const fm = FileManager.local();
  const path = storageFolder() + "/" + CACHE_KEY;
  try {
    const raw = fm.readString(path);
    if (raw && (allowStale || Date.now() - fm.modificationDate(path) <= CACHED_MS)) {
      return JSON.parse(raw);
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Appends one timestamped line to LunchMoneyWidget/diagnostics.txt in the
// Scriptable folder, so diagnostics are readable from the Files app even when
// the in-app preview hides the console
function writeDiagnostics(line) {
  try {
    const fm = FileManager.local();
    const folder = storageFolder();
    fm.createDirectory(folder, true);
    const path = folder + "/diagnostics.txt";
    const prev = fm.fileExists(path) ? fm.readString(path) : "";
    fm.writeString(path, prev + new Date().toISOString() + " " + line + "\n");
  } catch (e) {
    // never block rendering on diagnostics
  }
}

// Persists the latest result to the cache file
function writeCache(data) {
  const fm = FileManager.local();
  const folder = storageFolder();
  fm.createDirectory(folder, true);
  fm.writeString(folder + "/" + CACHE_KEY, JSON.stringify(data));
}

/****************************************************
             Widget Layouts
*****************************************************/

// Top-level renderer: picks stacked / review / overview / breakdown layouts
function renderWidget(mainStack, data, config) {
  switch (config.layout) {
    case "stacked":
      addBrandTitle(mainStack);
      addStackedMetrics(mainStack, data, config);
      break;
    case "review":
      addHeader(mainStack);
      mainStack.addSpacer(6);
      addReviewSplit(mainStack, data, config);
      mainStack.addSpacer();
      break;
    case "overview":
      addHeader(mainStack);
      mainStack.addSpacer(8);
      addOverview(mainStack, data, config);
      mainStack.addSpacer();
      break;
    default: // breakdown / extraLarge
      addBreakdownLayout(mainStack, data, config);
      break;
  }
}

// extraLarge: Leftover summary plus Inflow / Outflow detail lines; taps open Budget
function addBreakdownLayout(mainStack, data, config) {
  addHeader(mainStack);
  mainStack.addSpacer(6);
  const budget = mainStack.addStack();
  budget.layoutVertically();
  budget.url = BUDGET_URL;
  addCaption(budget, "Leftover", config.caption);
  addAmount(budget, data.savings, config.amount);
  budget.addSpacer(10);
  addBreakdown(budget, data, config.detailFont);
  mainStack.addSpacer();
}

// Inflow / Outflow / Leftover stacked vertically (small, in-app preview).
// The stack fills the whole widget so any tap opens Budget.
function addStackedMetrics(parent, data, config) {
  const stack = parent.addStack();
  stack.layoutVertically();
  stack.layoutWeight = 1;
  stack.url = BUDGET_URL;
  addMetrics(stack, data, config, config.inflowAmount, config.leftoverAmount);
}

// Brand title row for the small stacked widget and the large headers
function addBrandTitle(parent) {
  addCenteredText(parent, "LUNCH MONEY", {
    font: Font.boldSystemFont(12),
    color: brandGreen
  });
}

// Inflow / Leftover / Outflow across the width as three equal columns that scale
function addMetricRow(parent, data, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  const metrics = [
    ["Inflow", Math.abs(data.inflow)],
    ["Leftover", data.savings],
    ["Outflow", data.outflow]
  ];
  for (const [label, value] of metrics) {
    addMetricColumn(row, label, value, config);
  }
  return row;
}

// One metric column; layoutWeight divides the row equally so it scales across sizes
function addMetricColumn(parentRow, label, value, config) {
  const col = parentRow.addStack();
  col.layoutVertically();
  col.layoutWeight = 1;
  col.spacing = 2;
  addCaption(col, label, config.caption);
  // Leftover colors by sign, other metrics stay white
  addAmount(col, value, config.amount, label === "Leftover" ? undefined : regularColor);
}

// Large layout: metric columns across the width plus the unreviewed list below
function addOverview(mainStack, data, config) {
  const metricRow = addMetricRow(mainStack, data, config);
  metricRow.url = BUDGET_URL;
  mainStack.addSpacer(14);
  addCaption(mainStack, "Unreviewed", config.caption);
  const list = mainStack.addStack();
  list.layoutVertically();
  list.layoutWeight = 1;
  list.url = UNREVIEWED_URL;
  addUnreviewedItems(list, data, config);
}

// Medium layout: metrics top-aligned on the left, unreviewed transactions on the right
function addReviewSplit(mainStack, data, config) {
  const row = mainStack.addStack();
  row.layoutHorizontally();

  const left = row.addStack();
  left.layoutVertically();
  left.layoutWeight = 27;
  left.url = BUDGET_URL;
  addMetrics(left, data, config, config.amount, config.leftoverAmount || config.amount, true);
  left.addSpacer();
  left.addSpacer(10);

  const right = row.addStack();
  right.layoutVertically();
  right.layoutWeight = 73;
  right.url = UNREVIEWED_URL;
  addCaption(right, "Unreviewed", config.caption, true);
  addUnreviewedItems(right, data, config);
  right.addSpacer();
}

// Inflow / Outflow / Leftover rows, sharing one badge + amount style.
// The leftover line is taller and (when left-aligned) reserves room for the
// largest plausible amount so the column width stays stable.
function addMetrics(parent, data, config, amountSize, leftoverSize, alignLeft) {
  const metrics = [
    ["Inflow", Math.abs(data.inflow), amountSize, regularColor, null],
    ["Outflow", data.outflow, amountSize, regularColor, null],
    ["Leftover", data.savings, leftoverSize, undefined,
     alignLeft ? textWidth(formatMoney(99999), leftoverSize) : undefined]
  ];
  for (const [label, value, size, color, minWidth] of metrics) {
    addCaption(parent, label, config.caption, alignLeft);
    addAmount(parent, value, size, color, alignLeft, minWidth);
  }
}

// Every unreviewed transaction that fits without clipping, or an inline
// empty/diagnostic notice. The count is derived from the widget's fixed
// height minus everything rendered above the list, so we never let a row
// run past the widget's bottom edge.
function addUnreviewedItems(parent, data, config) {
  const items = (data.unreviewed || []).slice(0, maxUnreviewedCount(data, config));
  if (items.length === 0) {
    addUnreviewedEmpty(parent, data.unreviewedDiag, config);
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
    return height - PADDING_Y - HEADER_H - 6 - lineHeight(config.caption);
  }
  if (config.layout === "overview") {
    const metricRowH = lineHeight(config.caption) + STACK_SPACING + lineHeight(config.amount);
    return height - PADDING_Y - HEADER_H - 8 - metricRowH - 14 - lineHeight(config.caption);
  }
  return 0;
}

// One transaction row: text line plus the trailing 3pt spacer between rows
function rowFitHeight(config) {
  return lineHeight(config.detailFont || 9) + 3;
}

// How many rows fit cleanly: the raw fit minus a small slop so the last row
// is never partially cut off at the widget's bottom edge
function maxUnreviewedCount(data, config) {
  const items = data.unreviewed || [];
  if (items.length === 0) return 0;
  const budget = listHeightBudget(config);
  const count = Math.max(1, Math.floor((budget - 4) / rowFitHeight(config)));
  return Math.min(items.length, count);
}

// Unreviewed section fallback; shows inline diagnostics when nothing was fetched
function addUnreviewedEmpty(parent, diag, config) {
  const text = diag ? diag : "None";
  const empty = parent.addText(text);
  empty.font = font(Math.max(7, (config.detailFont || 9) - 2));
  empty.textColor = regularColor;
  empty.textOpacity = diag ? 0.8 : 0.6;
  empty.lineLimit = 3;
  empty.minimumScaleFactor = 0.6;
}

// One unreviewed transaction: payee + amount on a single line (no date)
function addTransactionRow(parent, t, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  const fontSize = config.detailFont || 9;
  const payee = row.addText(clip(t.payee, config.payeeLen || 16));
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

  parent.addSpacer(3);
}

// Truncate to max characters, hinting overflow with an ellipsis
function clip(text, max) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Title + budget period label rows used by medium and extraLarge layouts
function addHeader(mainStack) {
  addBrandTitle(mainStack);
  addCenteredText(mainStack, budgetPeriodLabel(), {
    font: regularFont,
    color: regularColor
  });
}

// Text shown under the title: pay cycle when requested, otherwise current month
function budgetPeriodLabel() {
  if (USE_PAY_CYCLE) return "CURRENT PAY CYCLE";
  return MONTHS[new Date().getMonth()].toUpperCase();
}

// A single centered line: flexible spacers on both sides keep the label centered,
// so it takes the full width even in a mixed-size layout
function addCenteredText(parent, text, style) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const label = row.addText(text);
  label.font = style.font;
  if (style.color != null) label.textColor = style.color;
  label.centerAlignText();
  if (style.opacity != null) label.textOpacity = style.opacity;
  row.addSpacer();
  return label;
}

// One horizontal row holding a single styled text. Centered lines are framed by
// flexible spacers; left-aligned lines hug the text with no trailing spacer
// (a trailing flex spacer inflates the row's implicit width and widens the
// whole column). Returns { row, label } so callers can tweak the text or
// append fixed spacers afterwards.
function addTextRow(parent, text, options) {
  const row = parent.addStack();
  row.layoutHorizontally();
  if (!options.alignLeft) row.addSpacer();
  const label = row.addText(text);
  label.font = options.font;
  if (options.color != null) label.textColor = options.color;
  if (options.alignLeft) {
    label.leftAlignText();
  } else {
    label.centerAlignText();
    row.addSpacer();
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

// Bold monetary value; colored by sign unless colorOverride is given.
// Centered unless alignLeft is set. A minWidth (points) reserves fixed room
// for the row so the column width stays stable across amounts.
function addAmount(parent, value, size, colorOverride, alignLeft, minWidth) {
  const text = formatMoney(value);
  const { row, label } = addTextRow(parent, text, {
    font: boldFont(size),
    color: colorOverride || (value < 0 ? lossRed : brandGreen),
    alignLeft
  });
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.5;
  if (minWidth) {
    const extra = minWidth - textWidth(text, size);
    if (extra > 0) row.addSpacer(extra);
  }
}

// extraLarge: Leftover amount plus Inflow / Outflow detail lines
function addBreakdown(mainStack, data, detailFont) {
  const rows = [
    ["Inflow", Math.abs(data.inflow)],
    ["Outflow", data.outflow]
  ];
  for (const [label, value] of rows) {
    addDetailRow(mainStack, label, value, detailFont);
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