/****************************************************
             CONFIGURATION
*****************************************************/
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E',
  error1: '#800000',
  error2: '#080000'
};

const BRAND_GREEN = '#44958C';
const BRAND_YELLOW = '#FBB700';
const LOSS_RED = '#E15554';

const FONT_NAME = "Menlo"
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

const BASE_URL = 'https://api.lunchmoney.dev/v2';

const local = FileManager.local();
const iCloud = FileManager.iCloud();

const BASE_FILE = 'LunchMoneyWidget';
const API_FILE = "apiKey";
const CACHE_KEY = "lunchMoneyCache_v2";
const CACHED_MS = 600000; // 10 minutes

// TEMPORARY: set to false and it returns to the current budget period
const TEMP_SHOW_LAST_MONTH = true;

const LOCAL = "local";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const USE_PAY_CYCLE = args.widgetParameter != null
const PAY_CYCLE_ID = args.widgetParameter;

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
const cache = new Cache("iCloud");
const LM_ACCESS_TOKEN = await getApiKey();
const widget = await getWidget();

Script.setWidget(widget);
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
    addErrorState(widget, widgetFamily, errorMessage);
    return widget;
  }

  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  Layout[widgetFamily](mainStack, lunchMoneyData);

  return widget;
};

function addErrorState(widget, widgetFamily, message) {
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
  const cached = cache.get(CACHE_KEY, CACHED_MS);
  if (cached) {
    return JSON.parse(cached);
  }
  
  const data = await lunchMoneyLeftoverInfo();

  // if not internet connection load data from cache
  if(!data){
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
  const exists = doesFileExist(keyLocation);
  if (exists) {
    const key = await readString(keyLocation, exists);
    if (key) return key;
  }
  const alert = new Alert();
  alert.addSecureTextField("api_key", "");
  alert.addAction("OK");
  alert.title = "Lunch Money API Key";
  alert.message = "Please enter your lunch money API key, found at https://my.lunchmoney.app/developers";

  const option = await alert.present();
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
    const params = range;
    params.include_totals = true;
    params.include_rollover_pool = true;
    const [summary, categories] = await Promise.all([
      sendLunchMoneyRequest(`${BASE_URL}/summary`, params),
      sendLunchMoneyRequest(`${BASE_URL}/categories`)
    ]);
    const result = computeLeftover(summary, categories);
    if (!config.widgetFamily && result) {
      console.log("Leftover summary:", JSON.stringify(result));
      console.log("raw totals:", JSON.stringify(summary.totals));
      const infoMap = buildCategoryInfo(categories);
      console.log("category detail:",
        JSON.stringify(
          summary.categories
            .filter((entry) => {
              return !(infoMap[entry.category_id] || {}).isIncome;
            })
            .map((entry) => {
              const info = categoryInfo[entry.category_id] || {};
              const initialBudget = entry.totals.budgeted;
              const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
              const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
              const available = entry.totals.available != null
                ? entry.totals.available
                : (initialBudget + rollover - activity);
              return {
                id: entry.category_id,
                budgeted: initialBudget,
                other_activity: entry.totals.other_activity,
                recurring_activity: entry.totals.recurring_activity,
                rollover,
                available,
                contribution: available >= 0 ? initialBudget : (initialBudget - available)
              };
            })
        )
      );
    }
    return result;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function computeLeftover(summary, categories) {
  if (!summary || !Array.isArray(summary.categories)) {
    return null;
  }

  const inflow = Math.abs(totalFromBreakdown(summary.totals && summary.totals.inflow));
  const categoryInfo = buildCategoryInfo(categories);

  const rows = summary.categories.filter((entry) => {
    const info = categoryInfo[entry.category_id] || {};
    return !info.isIncome;
  });

  const groupedBudgeted = {};
  for (const entry of rows) {
    const info = categoryInfo[entry.category_id] || {};
    if (info.isGroup && entry.totals.budgeted != null) {
      groupedBudgeted[entry.category_id] = true;
    }
  }

  let outflow = 0;
  for (const entry of rows) {
    const info = categoryInfo[entry.category_id] || {};
    if (info.groupId != null && groupedBudgeted[info.groupId]) continue;

    const initialBudget = entry.totals.budgeted;
    if (initialBudget == null) continue;

    const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
    const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
    const available = entry.totals.available != null
      ? entry.totals.available
      : (initialBudget + rollover - activity);

    outflow += (available >= 0) ? initialBudget : (initialBudget - available);
  }

  const leftover = inflow - outflow;
  return {
    inflow,
    outflow,
    savings: leftover
  };
}

function totalFromBreakdown(breakdown) {
  if (!breakdown) return 0;
  return Math.abs(breakdown.other_activity || 0)
       + Math.abs(breakdown.recurring_activity || 0)
       + Math.abs(breakdown.recurring_remaining || 0)
       + Math.abs(breakdown.uncategorized || 0);
}

function buildCategoryInfo(categories) {
  const info = {};
  const add = (category) => {
    info[category.id] = {
      isIncome: category.is_income,
      isGroup: !!category.is_group,
      groupId: category.group_id != null ? category.group_id : null
    };
    if (Array.isArray(category.children)) {
      category.children.forEach(add);
    }
  };
  (categories.categories || []).forEach(add);
  return info;
}

function sendLunchMoneyRequest(url, params = {}) {
  var headers;
  if(LM_ACCESS_TOKEN.includes("Bearer")){
    headers = {
      'Authorization': LM_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    };
  }
  else{
    headers = {
      'Authorization': `Bearer ${LM_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  return sendHTTPRequest(url, params, headers);
}

function sendHTTPRequest(url, params, headers, method = 'GET') {
  let query = ``;
  Object.keys(params).forEach((key, i) => {
    const value = params[key];
    query += i === 0 ? '?' : '&';
    query += `${key}=${value}`;
  });
  const request = new Request(url + query);
  request.headers = headers;
  request.method = method;
  log(request);
  return request.loadJSON();
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
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? "0" + month : month}-${day < 10 ? "0" + day : day}`;
}

function parseIsoDate(value) {
  const parts = String(value).split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

function addBudgetPeriod(date, settings, count) {
  const d = new Date(date.getTime());
  const quantity = settings.budget_period_quantity || 1;
  const granularity = settings.budget_period_granularity || "month";
  const units = quantity * count;
  for (let i = 0; i < units; i++) {
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

function getCalendarMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start_date: formatDateString(start),
    end_date: formatDateString(end)
  };
}

function getLastMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start_date: formatDateString(start),
    end_date: formatDateString(end)
  };
}

/****************************************************
            File Management
*****************************************************/

function saveToFile(content, key) {
    const folder = local.documentsDirectory() + "/LunchMoneyWidget";
    const filePath = folder + `/${key}`;

    local.createDirectory(folder, true);
    local.writeString(filePath, content)
}

async function readString(filePath, storage) {
    return local.readString(local.documentsDirectory() + "/" + filePath);
}

function doesFileExist(filePath) {
  if (local.fileExists(local.documentsDirectory() + "/" + filePath)) {
    return LOCAL;
  }
  return false;
}

function Cache(storage) {
  const fileManager = FileManager.local();
    
  const documentsDirectory = fileManager.documentsDirectory();
    
  const set = (key, content) => {
    const folder = documentsDirectory + "/" + BASE_FILE;
    fileManager.createDirectory(folder, true);
    fileManager.writeString(folder + "/" + key, content);
    // console.log(`save to cache: ${folder + "/" + key}`)
    // console.log(content);
  }
  
  const get = (key, cutOffTimeInMs) => {
    const cacheFilePath = documentsDirectory + "/" + BASE_FILE + "/" + key;
    const cacheCutOffDate = new Date(Date.now() - cutOffTimeInMs);
    const dateOfCacheModification = fileManager.modificationDate(cacheFilePath);
    const getFromCache = dateOfCacheModification > cacheCutOffDate;
    //Debug cache info
    // console.log(`Cache expired: ${!getFromCache}`);
    // console.log(`Cache read at: ${cacheFilePath}`);
    // console.log(`Cache last modified: \t${dateOfCacheModification}`);
    // console.log(`Cache expiry date: \t${cacheCutOffDate}`);
    try {
      return getFromCache
        ? fileManager.readString(cacheFilePath)
        : null;
    } catch(e) {
      console.error(e);
      return null;
    }
  }

  const forceGet = (key) => {
    const cacheFilePath = documentsDirectory + "/" + BASE_FILE + "/" + key;
    try {
      return fileManager.readString(cacheFilePath);
    } catch(e) {
      console.error(e);
      return null;
    }
  }
  
  return { set, get, forceGet };
}

/****************************************************
            Widget Layouts
*****************************************************/

function initLayout()
{
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
  const period = periodRow.addText(
    TEMP_SHOW_LAST_MONTH
      ? MONTHS[(new Date().getMonth() - 1 + 12) % 12].toUpperCase()
      : (USE_PAY_CYCLE ? "CURRENT PAY CYCLE" : MONTHS[new Date().getMonth()].toUpperCase())
  );
  period.font = regularFont;
  period.textColor = regularColor;
  period.centerAlignText();
  periodRow.addSpacer();
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
