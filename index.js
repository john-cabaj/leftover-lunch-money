/****************************************************
             CONFIGURATION
*****************************************************/
// Widget background gradient (top and bottom colors)
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E'
};

// BRAND_GREEN: positive amounts; BRAND_YELLOW: captions/labels; LOSS_RED: negative leftover
const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

// Monospace typography for a terminal feel; white is the default text color
const FONT_NAME = "Menlo";
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

// Lunch Money API base URL
const BASE_URL = 'https://api.lunchmoney.dev/v2';

// BASE_FILE: folder for cached data; API_KEY: Keychain entry for the API token;
// CACHE_KEY + CACHED_MS: cache file name and how long a fresh copy stays usable
const BASE_FILE = 'LunchMoneyWidget';
const API_KEY = "lunchMoneyApiKey";
const CACHE_KEY = "lunchMoneyCache_v2";
const CACHED_MS = 600000; // 10 minutes

// Month names for the header label
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Setting a widget parameter switches the header to "CURRENT PAY CYCLE"
const USE_PAY_CYCLE = args.widgetParameter != null;

// Per-widget-family appearance. undefined covers running in the app/preview.
const FAMILY_LAYOUTS = {
  small:      { layout: "stacked", caption: 11, inflowAmount: 20, leftoverAmount: 25 },
  medium:     { layout: "review", header: true, caption: 10, amount: 20, leftoverAmount: 24, detailFont: 9, payeeLen: 14, maxUnreviewed: 4 },
  large:      { layout: "overview", header: true, caption: 14, amount: 30, metricWidth: 120, detailFont: 12, payeeLen: 26, maxUnreviewed: 7 },
  extraLarge: { layout: "breakdown", header: true, caption: 15, amount: 46, detailFont: 11 },
  undefined:  { layout: "stacked", caption: 11, inflowAmount: 20, leftoverAmount: 25 }
};

/****************************************************
             SETUP - runs every time the widget loads
*****************************************************/

// Boot sequence: pull the API key, build the widget, then hand it to Scriptable
const LM_ACCESS_TOKEN = await getApiKey();
const widget = await getWidget();

Script.setWidget(widget);
if (config.runsInApp) {
  widget.presentMedium();
}
Script.complete();

/****************************************************
             WIDGET
*****************************************************/

// Builds the complete widget; drops an inline error state when data can't load
async function getWidget() {
  const widget = new ListWidget();
  widget.title = "Lunch Money";
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

  // Render the chosen family layout into a vertical stack
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  renderWidget(mainStack, lunchMoneyData, FAMILY_LAYOUTS[widgetFamily] || FAMILY_LAYOUTS.undefined);

  return widget;
};

// Centered "Leftover" caption plus the given message
function addErrorState(widget, message) {
  const mainStack = widget.addStack();
  mainStack.layoutVertically();

  const captionStack = mainStack.addStack();
  captionStack.layoutHorizontally();
  captionStack.addSpacer();
  const caption = captionStack.addText("Leftover");
  caption.font = new Font(FONT_NAME, 11);
  caption.textColor = new Color(BRAND_YELLOW);
  caption.centerAlignText();
  captionStack.addSpacer();

  const messageStack = mainStack.addStack();
  messageStack.layoutHorizontally();
  messageStack.addSpacer();
  const messageText = messageStack.addText(message);
  messageText.font = smallFont;
  messageText.textColor = regularColor;
  messageText.centerAlignText();
  messageText.textOpacity = 0.8;
  messageStack.addSpacer();
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
             UI FUNCTIONS
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
    return { ...computeLeftover(summary, categories), unreviewed };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Recent transactions awaiting review in the period, newest first
async function fetchUnreviewedTransactions(range) {
  try {
    const data = await sendLunchMoneyRequest(`${BASE_URL}/transactions`, {
      ...range,
      status: "unreviewed"
    });
    return (data && data.transactions || [])
      .filter((t) => !t.is_group && !t.is_pending)
      .sort((a, b) => (b.date === a.date
        ? (b.created_at || "").localeCompare(a.created_at || "")
        : b.date.localeCompare(a.date)))
      .map((t) => ({
        payee: t.display_name || t.payee || "Unknown",
        amount: t.to_base != null ? t.to_base : parseFloat(t.amount),
        date: t.date
      }));
  } catch (e) {
    console.error(e);
    return [];
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

  // Filter out double-counted rows, then shape each into a clean row object
  return rows
    .filter((entry) => shouldCountEntry(entry, info[entry.category_id] || {}, groupedBudgeted, groupHasBudgetedChildren))
    .map((entry) => {
      const initialBudget = entry.totals.budgeted;
      const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
      const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
      const available = entry.totals.available != null
        ? entry.totals.available
        : (initialBudget != null ? initialBudget + rollover - activity : null);
      return {
        name: names[entry.category_id] || entry.category_id,
        initialBudget,
        activity,
        rollover,
        available,
        contribution: categoryContribution(entry)
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

// A child row counts only when its group's budget is actually held at the children level;
// a group row counts only when it carries its own budget and no children do
function shouldCountEntry(entry, info, groupedBudgeted, groupHasBudgetedChildren) {
  if (info.groupId != null) {
    return groupedBudgeted[info.groupId] && !groupHasBudgetedChildren[info.groupId] ? false : true;
  }
  if (info.isGroup) {
    if (entry.totals.budgeted == null) return false;
    if (groupHasBudgetedChildren[entry.category_id]) return false;
  }
  return true;
}

// Budgeted categories spend at most their budget; over-budget categories spend the full
// original budget plus the overspend. Unbudgeted categories spend their activity.
function categoryContribution(entry) {
  const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
  const initialBudget = entry.totals.budgeted;
  if (initialBudget == null) return activity;
  const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
  const available = entry.totals.available != null
    ? entry.totals.available
    : (initialBudget + rollover - activity);
  return (available >= 0) ? initialBudget : (initialBudget - available);
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
      case "month":
        addMonthsClamped(d, 1);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + 1);
        if (d.getMonth() !== date.getMonth()) d.setDate(0);
        break;
      case "twice a month":
        d.setDate(d.getDate() + 15);
        break;
      default:
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

// Reads the cached result JSON; TTL-gated unless allowStale is set (offline fallback)
function readCache(allowStale) {
  const fm = FileManager.local();
  const path = fm.documentsDirectory() + "/" + BASE_FILE + "/" + CACHE_KEY;
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

// Persists the latest result to the cache file
function writeCache(data) {
  const fm = FileManager.local();
  const folder = fm.documentsDirectory() + "/" + BASE_FILE;
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
      addStackedMetrics(mainStack, data, config);
      mainStack.addSpacer();
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
    default:
      addHeader(mainStack);
      mainStack.addSpacer(6);
      addCaption(mainStack, "Leftover", config.caption);
      addAmount(mainStack, data.savings, config.amount);
      mainStack.addSpacer(10);
      addBreakdown(mainStack, data, config.detailFont);
      mainStack.addSpacer();
      break;
  }
}

// Inflow / Outflow / Leftover stacked vertically (small, in-app preview)
function addStackedMetrics(mainStack, data, config) {
  addCaption(mainStack, "Inflow", config.caption);
  addAmount(mainStack, Math.abs(data.inflow), config.inflowAmount, regularColor);
  addCaption(mainStack, "Outflow", config.caption);
  addAmount(mainStack, data.outflow, config.inflowAmount, regularColor);
  addCaption(mainStack, "Leftover", config.caption);
  addAmount(mainStack, data.savings, config.leftoverAmount);
}

// Inflow / Leftover / Outflow across the width as three columns
function addMetricRow(parent, data, config) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  addMetricColumn(row, "Inflow", Math.abs(data.inflow), config);
  row.addSpacer();
  addMetricColumn(row, "Leftover", data.savings, config);
  row.addSpacer();
  addMetricColumn(row, "Outflow", data.outflow, config);
  row.addSpacer();
}

// One metric column; the fixed width lets WidgetKit scale instead of wrapping
function addMetricColumn(parentRow, label, value, config) {
  const col = parentRow.addStack();
  col.layoutVertically();
  col.size = new Size(config.metricWidth || 0, 0);

  const labelRow = col.addStack();
  labelRow.layoutHorizontally();
  labelRow.addSpacer();
  const labelText = labelRow.addText(label);
  labelText.font = new Font(FONT_NAME, config.caption);
  labelText.textColor = new Color(BRAND_YELLOW);
  labelText.centerAlignText();
  labelRow.addSpacer();

  const valueRow = col.addStack();
  valueRow.layoutHorizontally();
  valueRow.addSpacer();
  const valueText = valueRow.addText(formatMoney(value));
  valueText.font = new Font("Menlo-Bold", config.amount);
  valueText.lineLimit = 1;
  valueText.minimumScaleFactor = 0.5;
  // Leftover is green when positive, red when negative; other metrics stay white
  valueText.textColor = label === "Leftover"
    ? (value < 0 ? new Color(LOSS_RED) : new Color(BRAND_GREEN))
    : regularColor;
  valueText.centerAlignText();
  valueRow.addSpacer();
}

// Large layout: metric columns across the width plus the unreviewed list below
function addOverview(mainStack, data, config) {
  addMetricRow(mainStack, data, config);
  mainStack.addSpacer(14);
  addCaption(mainStack, "Unreviewed", config.caption);
  const items = (data.unreviewed || []).slice(0, config.maxUnreviewed || 7);
  if (items.length === 0) {
    const empty = mainStack.addText("None");
    empty.font = new Font(FONT_NAME, config.detailFont || 11);
    empty.textColor = regularColor;
    empty.textOpacity = 0.6;
    empty.centerAlignText();
  } else {
    items.forEach((t) => addTransactionRow(mainStack, t, config));
  }
}

// Medium layout: stacked leftovers on the left, latest unreviewed transactions on the right
function addReviewSplit(mainStack, data, config) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer(2);

  const left = row.addStack();
  left.layoutVertically();
  left.addSpacer();
  addCaption(left, "Inflow", config.caption);
  addAmount(left, Math.abs(data.inflow), config.amount, regularColor);
  addCaption(left, "Outflow", config.caption);
  addAmount(left, data.outflow, config.amount, regularColor);
  addCaption(left, "Leftover", config.caption);
  addAmount(left, data.savings, config.leftoverAmount || config.amount);
  left.addSpacer();

  row.addSpacer(12);

  const right = row.addStack();
  right.layoutVertically();
  right.addSpacer();
  addCaption(right, "Unreviewed", config.caption);
  const items = (data.unreviewed || []).slice(0, config.maxUnreviewed || 4);
  if (items.length === 0) {
    const empty = right.addText("None");
    empty.font = new Font(FONT_NAME, config.detailFont || 9);
    empty.textColor = regularColor;
    empty.textOpacity = 0.6;
  } else {
    items.forEach((t) => addTransactionRow(right, t, config));
  }
  right.addSpacer();
  row.addSpacer(2);
}

// One unreviewed transaction: payee + amount on top, date underneath
function addTransactionRow(parent, t, config) {
  const block = parent.addStack();
  block.layoutVertically();

  const top = block.addStack();
  top.layoutHorizontally();
  top.addSpacer(0);
  const fontSize = config.detailFont || 9;
  const payee = top.addText(clip(t.payee, config.payeeLen || 16));
  payee.font = new Font(FONT_NAME, fontSize);
  payee.textColor = regularColor;
  payee.lineLimit = 1;
  top.addSpacer(6);
  const amount = top.addText(formatMoney(t.amount));
  amount.font = new Font("Menlo-Bold", fontSize);
  amount.lineLimit = 1;
  amount.minimumScaleFactor = 0.5;
  amount.textColor = t.amount < 0 ? new Color(LOSS_RED) : regularColor;
  amount.rightAlignText();
  top.addSpacer(0);

  const stamp = block.addText(t.date);
  stamp.font = new Font(FONT_NAME, Math.max(7, fontSize - 2));
  stamp.textColor = regularColor;
  stamp.textOpacity = 0.5;

  parent.addSpacer(3);
}

// Truncate to max characters, hinting overflow with an ellipsis
function clip(text, max) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Title + budget period label row used by medium and extraLarge layouts
function addHeader(mainStack) {
  const titleRow = mainStack.addStack();
  titleRow.layoutHorizontally();
  titleRow.addSpacer();
  const title = titleRow.addText("LUNCH MONEY");
  title.font = Font.boldSystemFont(12);
  title.textColor = new Color(BRAND_GREEN);
  title.centerAlignText();
  titleRow.addSpacer();

  const periodRow = mainStack.addStack();
  periodRow.layoutHorizontally();
  periodRow.addSpacer();
  const period = periodRow.addText(budgetPeriodLabel());
  period.font = regularFont;
  period.textColor = regularColor;
  period.centerAlignText();
  periodRow.addSpacer();
}

// Text shown under the title: pay cycle when requested, otherwise current month
function budgetPeriodLabel() {
  if (USE_PAY_CYCLE) return "CURRENT PAY CYCLE";
  return MONTHS[new Date().getMonth()].toUpperCase();
}

// Centered yellow label (e.g. "Inflow", "Leftover")
function addCaption(mainStack, text, size) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const caption = row.addText(text);
  caption.font = new Font(FONT_NAME, size);
  caption.textColor = new Color(BRAND_YELLOW);
  caption.centerAlignText();
  row.addSpacer();
}

// Centered bold monetary value; colored by sign unless colorOverride is given
function addAmount(mainStack, value, size, colorOverride) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const amount = row.addText(formatMoney(value));
  amount.font = new Font("Menlo-Bold", size);
  amount.lineLimit = 1;
  amount.minimumScaleFactor = 0.5;
  amount.textColor = colorOverride || (value < 0 ? new Color(LOSS_RED) : new Color(BRAND_GREEN));
  amount.centerAlignText();
  row.addSpacer();
}

// extraLarge: Leftover amount plus Inflow / Outflow detail lines
function addBreakdown(mainStack, data, detailFont) {
  addDetailRow(mainStack, "Inflow", Math.abs(data.inflow), detailFont);
  addDetailRow(mainStack, "Outflow", data.outflow, detailFont);
}

// Left-aligned label, right-aligned value on one line
function addDetailRow(mainStack, label, value, detailFont) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  const labelText = row.addText(label);
  labelText.font = new Font(FONT_NAME, detailFont || 9);
  labelText.textColor = regularColor;
  labelText.textOpacity = 0.6;
  row.addSpacer(8);
  const valueText = row.addText(formatMoney(value));
  valueText.font = new Font(FONT_NAME, detailFont || 9);
  valueText.lineLimit = 1;
  valueText.minimumScaleFactor = 0.5;
  valueText.textColor = regularColor;
  valueText.rightAlignText();
}