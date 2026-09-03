/****************************************************
             CONFIGURATION
*****************************************************/
const COLORS = {
  bg1: '#1D1F21',
  bg2: '#282A2E',
  error1: '#800000',
  error2: '#080000'
};

const FONT_NAME = "Menlo"
const regularFont = new Font(FONT_NAME, 11);
const smallFont = new Font(FONT_NAME, 9);
const regularColor = Color.white();

const BASE_URL = 'https://api.lunchmoney.dev/v2/';

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
  
  const responses = await Promise.all([
    lunchMoneyLeftoverInfo(),
  ])

  // if not internet connection load data from cache
  if(!responses[0]){
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
  const url = `${BASE_URL}/summary`;
  params = getStartAndEndDateForPayCycle();
  try {
    const response = await sendLunchMoneyRequest(url, params);
    return response.transactions.length;
  } catch (e) {
    console.error(e);
    return null;
  }
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
  
  return request.loadJSON();
}

/****************************************************
            Utilities
*****************************************************/

function getStartAndEndDateForPayCycle() {
  const now = new Date();
  let month = now.getMonth();
  let day = now.getDate();
  if(day<10)day="0"+day;
  const prevMonthStr = month < 10 ? "0" + month : month;
  month++;
  const currentMonthStr = month < 10 ? "0" + month : month;
  const start_date = `${now.getFullYear()}-${prevMonthStr}-01`;
  const end_date = `${now.getFullYear()}-${currentMonthStr}-${day}`;
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
  Layout.medium = function(mainStack, lunchMoneyData){
    // HEADER
    const headingStack = mainStack.addStack();
    headingStack.layoutHorizontally();
    headingStack.addSpacer();
    const headerText = headingStack.addText(`💰 LUNCH MONEY LEFTOVERS - ${USE_PAY_CYCLE ? "Current Pay cycle" : MONTHS[new Date().getMonth()]} 💰`);
    headingStack.addSpacer();
    headerText.font = regularFont;
    headerText.textColor = regularColor;
    headerText.centerAlignText();  
    mainStack.addSpacer(2);

    // LEFTOVER
    const savingsStack = mainStack.addStack();
    savingsStack.layoutHorizontally();
    const savingsText = savingsStack.addText("🏦");
    savingsText.font = regularFont;
    savingsText.textColor = regularColor;
    savingsStack.addSpacer();
    const savingsNum = savingsStack.addText(lunchMoneyData.savings);
    savingsNum.font = regularFont;
    savingsNum.textColor = lunchMoneyData.savings?.startsWith('-') ? Color.red() : Color.green();
    savingsNum.rightAlignText();

    mainStack.addSpacer();
  }

  Layout.extraLarge = Layout.large;
  //when running the script from the app config.widgetFamily is undefined, don't excute layout logic in that case
  Layout.undefined = function(mainStack, lunchMoneyData){};
  return Layout;
}
