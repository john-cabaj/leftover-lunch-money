/****************************************************
             CONFIGURATION
*****************************************************/
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E'
};

const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

let DEBUG_LINES = [];

const FONT_NAME = "Menlo";
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

const BASE_URL = 'https://api.lunchmoney.dev/v2';

const local = FileManager.local();

const BASE_FILE = 'LunchMoneyWidget';
const API_FILE = "apiKey";
const CACHE_KEY = "lunchMoneyCache_v2";
const CACHED_MS = 600000; // 10 minutes

// TEMPORARY: set to false and it returns to the current budget period
const TEMP_SHOW_LAST_MONTH = true;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const USE_PAY_CYCLE = args.widgetParameter != null;

const FAMILY_LAYOUTS = {
  small:      { layout: "stacked", caption: 11, inflowAmount: 20, leftoverAmount: 25 },
  medium:     { layout: "columns", header: true, caption: 12, amount: 26 },
  large:      { layout: "breakdown", header: true, caption: 14, amount: 40, detailFont: 10 },
  extraLarge: { layout: "breakdown", header: true, caption: 15, amount: 46, detailFont: 11 },
  undefined:  { layout: "stacked", caption: 11, inflowAmount: 20, leftoverAmount: 25 }
};

/****************************************************
             SETUP
*****************************************************/

const Layout = initLayout();
const cache = new Cache();
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

  if (!widgetFamily && DEBUG_LINES.length) {
    const debugStack = widget.addStack();
    debugStack.layoutVertically();
    debugStack.spacing = 1;
    for (const line of DEBUG_LINES) {
      const t = debugStack.addText(line);
      t.font = new Font(FONT_NAME, 8);
      t.textColor = regularColor;
      t.textOpacity = 0.9;
    }
    return widget;
  }

  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  Layout[widgetFamily](mainStack, lunchMoneyData);

  return widget;
};

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

async function getAllData() {
  const debugRun = !config.widgetFamily;
  const cached = debugRun ? null : cache.get(CACHE_KEY, CACHED_MS);
  if (cached) {
    return JSON.parse(cached);
  }

  const data = await lunchMoneyLeftoverInfo();

  // if not internet connection load data from cache
  if (!data) {
    const forced = cache.forceGet(CACHE_KEY);
    return forced ? JSON.parse(forced) : null;
  }

  cache.set(CACHE_KEY, JSON.stringify(data));
  return data;
}

/****************************************************
             UI FUNCTIONS
*****************************************************/

function getLinearGradient(color1, color2) {
  const gradient = new LinearGradient();
  gradient.colors = [new Color(color1), new Color(color2)];
  gradient.locations = [0.0, 1.0];
  return gradient;
};

/****************************************************
             API
*****************************************************/

async function getApiKey() {
  const keyLocation = BASE_FILE + "/" + API_FILE;
  if (doesFileExist(keyLocation)) {
    const key = await readString(keyLocation);
    if (key) return key;
  }
  const alert = new Alert();
  alert.addSecureTextField("api_key", "");
  alert.addAction("OK");
  alert.title = "Lunch Money API Key";
  alert.message = "Please enter your lunch money API key, found at https://my.lunchmoney.app/developers";

  await alert.present();
  const apiKey = alert.textFieldValue(0);

  if (apiKey) {
    saveToFile(apiKey, API_FILE);
    return apiKey;
  }
  return null;
}

async function lunchMoneyLeftoverInfo() {
  if (!LM_ACCESS_TOKEN) {
    return null;
  }
  try {
    const settings = await sendLunchMoneyRequest(`${BASE_URL}/budgets/settings`);
    const range = TEMP_SHOW_LAST_MONTH
      ? getLastMonthRange()
      : (getCurrentBudgetPeriod(settings) || getCalendarMonthRange());
    const params = { ...range, include_totals: true, include_rollover_pool: true };
    const [summary, categories] = await Promise.all([
      sendLunchMoneyRequest(`${BASE_URL}/summary`, params),
      sendLunchMoneyRequest(`${BASE_URL}/categories`)
    ]);
    const result = computeLeftover(summary, categories);
    console.log("Leftover summary: " + JSON.stringify(result));
    console.log("raw totals: " + JSON.stringify(summary.totals));
    DEBUG_LINES = buildCategoryDebugLines(summary, categories, result);
    DEBUG_LINES.forEach((line) => console.log("category detail: " + line));
    return result;
  } catch (e) {
    console.error(e);
    return null;
  }
}

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
  log(request);
  return request.loadJSON();
}

/****************************************************
             Leftover Calculation
*****************************************************/

function categoryRows(summary, categories) {
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

  const rows = (summary.categories || []).filter((entry) => !(info[entry.category_id] || {}).isIncome);

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

function buildCategoryDebugLines(summary, categories, result) {
  const lines = [
    `INFLOW ${formatMoney(result ? result.inflow : 0)} OUTFLOW ${formatMoney(result ? result.outflow : 0)} LEFTOVER ${formatMoney(result ? result.savings : 0)}`
  ];
  for (const row of categoryRows(summary, categories)) {
    lines.push(`${row.name} | bud ${row.initialBudget == null ? "-" : row.initialBudget} spend ${row.activity.toFixed(2)} avail ${row.available == null ? "-" : row.available.toFixed(2)} roll ${row.rollover.toFixed(2)} | contrib ${formatMoney(row.contribution)}`);
  }
  return lines;
}

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

function formatMoney(value) {
  if (!isFinite(value)) return "$0.00";
  const abs = Math.abs(value).toFixed(2);
  return (value < 0 ? "-" : "") + "$" + abs;
}

function formatDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseIsoDate(value) {
  const parts = String(value).split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

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

function addMonthsClamped(date, n) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  date.setFullYear(target.getFullYear());
  date.setMonth(target.getMonth());
  date.setDate(Math.min(day, lastDay));
}

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

function monthRange(monthOffset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  return {
    start_date: formatDateString(start),
    end_date: formatDateString(end)
  };
}

function getCalendarMonthRange() {
  return monthRange(0);
}

function getLastMonthRange() {
  return monthRange(-1);
}

/****************************************************
            File Management
*****************************************************/

function saveToFile(content, key) {
  const folder = local.documentsDirectory() + "/" + BASE_FILE;
  local.createDirectory(folder, true);
  local.writeString(folder + "/" + key, content);
}

async function readString(keyLocation) {
  return local.readString(local.documentsDirectory() + "/" + keyLocation);
}

function doesFileExist(keyLocation) {
  return local.fileExists(local.documentsDirectory() + "/" + keyLocation);
}

function Cache() {
  const fileManager = FileManager.local();
  const documentsDirectory = fileManager.documentsDirectory();

  const read = (key) => fileManager.readString(documentsDirectory + "/" + BASE_FILE + "/" + key);

  const set = (key, content) => {
    const folder = documentsDirectory + "/" + BASE_FILE;
    fileManager.createDirectory(folder, true);
    fileManager.writeString(folder + "/" + key, content);
  };

  const get = (key, cutOffTimeInMs) => {
    const cacheFilePath = documentsDirectory + "/" + BASE_FILE + "/" + key;
    const cacheCutOffDate = new Date(Date.now() - cutOffTimeInMs);
    try {
      return fileManager.modificationDate(cacheFilePath) > cacheCutOffDate ? read(key) : null;
    } catch (e) {
      return null;
    }
  };

  const forceGet = (key) => {
    try {
      return read(key);
    } catch (e) {
      return null;
    }
  };

  return { set, get, forceGet };
}

/****************************************************
            Widget Layouts
*****************************************************/

function initLayout() {
  let Layout = {};
  for (const family of Object.keys(FAMILY_LAYOUTS)) {
    const config = FAMILY_LAYOUTS[family];
    Layout[family] = (mainStack, lunchMoneyData) => renderWidget(mainStack, lunchMoneyData, config);
  }
  return Layout;
}

function renderWidget(mainStack, data, config) {
  switch (config.layout) {
    case "stacked":
      addStackedMetrics(mainStack, data, config);
      mainStack.addSpacer();
      break;
    case "columns":
      addHeader(mainStack);
      mainStack.addSpacer(6);
      addMetricRow(mainStack, data, config);
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

function addStackedMetrics(mainStack, data, config) {
  addCaption(mainStack, "Inflow", config.caption);
  addAmount(mainStack, Math.abs(data.inflow), config.inflowAmount, regularColor);
  addCaption(mainStack, "Outflow", config.caption);
  addAmount(mainStack, data.outflow, config.inflowAmount, regularColor);
  addCaption(mainStack, "Leftover", config.caption);
  addAmount(mainStack, data.savings, config.leftoverAmount);
}

function addMetricRow(mainStack, data, config) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  addMetricColumn(row, "Inflow", Math.abs(data.inflow), config);
  row.addSpacer();
  addMetricColumn(row, "Leftover", data.savings, config);
  row.addSpacer();
  addMetricColumn(row, "Outflow", data.outflow, config);
  row.addSpacer();
}

function addMetricColumn(parentRow, label, value, config) {
  const col = parentRow.addStack();
  col.layoutVertically();

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
  valueText.textColor = label === "Leftover"
    ? (value < 0 ? new Color(LOSS_RED) : new Color(BRAND_GREEN))
    : regularColor;
  valueText.centerAlignText();
  valueRow.addSpacer();
}

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

function budgetPeriodLabel() {
  if (TEMP_SHOW_LAST_MONTH) return MONTHS[(new Date().getMonth() - 1 + 12) % 12].toUpperCase();
  if (USE_PAY_CYCLE) return "CURRENT PAY CYCLE";
  return MONTHS[new Date().getMonth()].toUpperCase();
}

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

function addAmount(mainStack, value, size, colorOverride) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const amount = row.addText(formatMoney(value));
  amount.font = new Font("Menlo-Bold", size);
  amount.textColor = colorOverride || (value < 0 ? new Color(LOSS_RED) : new Color(BRAND_GREEN));
  amount.centerAlignText();
  row.addSpacer();
}

function addBreakdown(mainStack, data, detailFont) {
  addDetailRow(mainStack, "Inflow", Math.abs(data.inflow), detailFont);
  addDetailRow(mainStack, "Outflow", data.outflow, detailFont);
}

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
  valueText.textColor = regularColor;
  valueText.rightAlignText();
}