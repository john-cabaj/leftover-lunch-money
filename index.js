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
const CACHE_KEY = "lunchMoneyCache";
const CACHED_MS = 7200000; // 2 hours

const LOCAL = "local";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const USE_PAY_CYCLE = args.widgetParameter != null
const PAY_CYCLE_ID = args.widgetParameter;

const FAMILY_LAYOUTS = {
  small:      { caption: 10, amount: 20, header: false, breakdown: false },
  medium:     { caption: 11, amount: 26, header: true,  breakdown: false },
  large:      { caption: 12, amount: 30, header: true,  breakdown: true },
  extraLarge: { caption: 12, amount: 34, header: true,  breakdown: true },
  undefined:  { caption: 11, amount: 26, header: false, breakdown: false }
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
  const lunchMoneyData = await getAllData();
  
  const widget = new ListWidget();
  widget.title = "Lunch Money";
  widget.backgroundGradient = getLinearGradient(COLORS.bg1, COLORS.bg2);
  
  const mainStack = widget.addStack();
  mainStack.layoutVertically();
  mainStack.spacing = 2;
  
  const widgetFamily = config.widgetFamily;
  Layout[widgetFamily](mainStack, lunchMoneyData);

  return widget;
};

async function getAllData() {
  const cached = cache.get(CACHE_KEY, CACHED_MS);
  if (cached) {
    return JSON.parse(cached);
  }
  
  const data = await lunchMoneyLeftoverInfo();

  // if not internet connection load data from cache
  if(!data){
    return JSON.parse(cache.forceGet(CACHE_KEY));
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
    return await readString(keyLocation, exists);
  }
  const alert = new Alert();
  alert.addSecureTextField("api_key", "");
  alert.addAction("OK");
  alert.title = "Lunch Money API Key";
  alert.message = "Please enter your lunch money API key, found at https://my.lunchmoney.app/developers";

  const option = await alert.present();
  const apiKey = alert.textFieldValue(0);
  
  saveToFile(apiKey, API_FILE);
  return apiKey;
}

async function lunchMoneyLeftoverInfo() {
  const params = getStartAndEndDateForPayCycle();
  params.include_totals = true;
  params.include_rollover_pool = true;
  try {
    const [summary, categories] = await Promise.all([
      sendLunchMoneyRequest(`${BASE_URL}/summary`, params),
      sendLunchMoneyRequest(`${BASE_URL}/categories`)
    ]);
    return computeLeftover(summary, categories);
  } catch (e) {
    console.error(e);
    return null;
  }
}

function computeLeftover(summary, categories) {
  const inflow = totalFromBreakdown(summary.totals && summary.totals.inflow);
  const categoryInfo = buildCategoryInfo(categories);

  let budgeted = 0;
  let overspend = 0;
  for (const entry of (summary.categories || [])) {
    const info = categoryInfo[entry.category_id];
    if (info && info.isIncome) continue;
    if (info && info.groupId != null) continue;

    const initialBudget = entry.totals.budgeted;
    if (initialBudget == null) continue;

    budgeted += initialBudget;
    const activity = (entry.totals.other_activity || 0) + (entry.totals.recurring_activity || 0);
    const rollover = entry.rollover_pool ? (entry.rollover_pool.budgeted_to_base || 0) : 0;
    overspend += Math.max(0, activity - (initialBudget + rollover));
  }

  const outflow = budgeted + overspend;
  const leftover = inflow - outflow;
  return {
    inflow,
    outflow,
    budgeted,
    overspend,
    savings: leftover
  };
}

function totalFromBreakdown(breakdown) {
  if (!breakdown) return 0;
  return (breakdown.other_activity || 0)
       + (breakdown.recurring_activity || 0)
       + (breakdown.recurring_remaining || 0)
       + (breakdown.uncategorized || 0);
}

function buildCategoryInfo(categories) {
  const info = {};
  const add = (category) => {
    info[category.id] = {
      isIncome: category.is_income,
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
  const abs = Math.abs(value).toFixed(2);
  return (value < 0 ? "-" : "") + "$" + abs;
}

function getStartAndEndDateForPayCycle() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const currentMonthStr = month < 10 ? "0" + month : month;
  const dayStr = day < 10 ? "0" + day : day;
  const start_date = `${now.getFullYear()}-${currentMonthStr}-01`;
  const end_date = `${now.getFullYear()}-${currentMonthStr}-${dayStr}`;
  return {start_date, end_date};
}

/****************************************************
            File Management
*****************************************************/

function saveToFile(content, key) {
    const folder = iCloud.documentsDirectory() + "/LunchMoneyWidget";
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
  if (config.header) {
    addHeader(mainStack);
    mainStack.addSpacer(6);
  }

  addCaption(mainStack, "Leftover", config.caption);
  addAmount(mainStack, data.savings, config.amount);

  if (config.breakdown) {
    mainStack.addSpacer(10);
    addBreakdown(mainStack, data);
  } else {
    mainStack.addSpacer();
  }
}

function addHeader(mainStack) {
  const titleRow = mainStack.addStack();
  titleRow.layoutHorizontally();
  titleRow.addSpacer();
  const title = titleRow.addText("LUNCH MONEY");
  title.font = Font.semiboldSystemFont(11);
  title.textColor = new Color(BRAND_GREEN);
  title.centerAlignText();
  titleRow.addSpacer();

  const periodRow = mainStack.addStack();
  periodRow.layoutHorizontally();
  periodRow.addSpacer();
  const period = periodRow.addText(USE_PAY_CYCLE ? "CURRENT PAY CYCLE" : MONTHS[new Date().getMonth()].toUpperCase());
  period.font = smallFont;
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

function addAmount(mainStack, value, size) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const amount = row.addText(formatMoney(value));
  amount.font = new Font("Menlo-Bold", size);
  amount.textColor = value < 0 ? new Color(LOSS_RED) : new Color(BRAND_GREEN);
  amount.centerAlignText();
  row.addSpacer();
}

function addBreakdown(mainStack, data) {
  addDetailRow(mainStack, "Inflow", data.inflow);
  addDetailRow(mainStack, "Outflow", data.outflow);
  addDetailRow(mainStack, "Budgeted", data.budgeted);
  addDetailRow(mainStack, "Overspend", data.overspend);
}

function addDetailRow(mainStack, label, value) {
  const row = mainStack.addStack();
  row.layoutHorizontally();
  const labelText = row.addText(label);
  labelText.font = smallFont;
  labelText.textColor = regularColor;
  labelText.textOpacity = 0.6;
  row.addSpacer(8);
  const valueText = row.addText(formatMoney(value));
  valueText.font = smallFont;
  valueText.textColor = regularColor;
  valueText.rightAlignText();
}
