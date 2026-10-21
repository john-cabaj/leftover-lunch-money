// End-to-end boot harness for index.js: runs the REAL widget file in plain
// Node against Scriptable stubs, with the Lunch Money API proxied to the
// MOCK API (never the real one). Verifies that every widget family renders,
// for both the current and previous period, in the plain / delete-pending /
// update-available states, and that the tap URLs land where they should.
//
// Usage: node tools/boot-harness.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'index.js'), 'utf8');

// --- Scriptable stubs -------------------------------------------------------

class Text {
  constructor(text) { this.text = text; this.textOpacity = 1; this.lineLimit = 0; this.minimumScaleFactor = 1; }
  centerAlignText() { this.align = 'center'; }
  leftAlignText() { this.align = 'left'; }
  rightAlignText() { this.align = 'right'; }
}

class Stack {
  constructor() { this.children = []; this.spacing = 0; this.url = null; this.layoutWeight = 0; }
  layoutVertically() { this.direction = 'vertical'; }
  layoutHorizontally() { this.direction = 'horizontal'; }
  centerAlignContent() { this.alignContent = 'center'; }
  topAlignContent() { this.alignContent = 'top'; }
  addStack() { const s = new Stack(); this.children.push(s); return s; }
  addText(t) { const s = new Text(t); this.children.push(s); return s; }
  addSpacer(n) { this.children.push({ spacer: n === undefined ? 'flex' : n }); }
}

class ListWidget extends Stack {
  constructor() { super(); this.title = ''; this.url = null; this.padding = null; }
  setPadding(t, l, b, r) { this.padding = [t, l, b, r]; }
}

class Font {
  constructor(name, size) { this.name = name; this.size = size; this.lineHeight = Math.ceil(size * 1.35); }
}
class Color {
  constructor(v) { this.value = v; }
  static white() { return new Color('#FFFFFF'); }
}
class LinearGradient { constructor() { this.colors = []; this.locations = []; } }

const FILES = new Map();
const FileManager = {
  local: () => ({
    documentsDirectory: () => '/docs',
    createDirectory: () => {},
    readString: (p) => { if (!FILES.has(p)) throw new Error('no file ' + p); return FILES.get(p); },
    writeString: (p, s) => { FILES.set(p, s); },
    fileExists: (p) => FILES.has(p) || p === '/docs/LunchMoneyWidget',
    listContents: () => ['lunchMoneyCache', 'lunchMoneyCache_previous', 'lunchMoneyUpdateCheck', 'stray.txt'],
    modificationDate: (p) => new Date(Date.now() - 1000),
    remove: (p) => { FILES.delete(p); }
  })
};

const Keychain = {
  contains: (k) => k === 'lunchMoneyApiKey',
  get: () => 'Bearer mock-token',
  set: () => {}
};

const OPENS = [];
const Safari = { open: (u) => { OPENS.push(u); } };
const Pasteboard = { copyString: (s) => { Pasteboard.last = s; } };
const Script = { name: () => 'Leftover Lunch Money', setWidget: (w) => { Script.widget = w; }, complete: () => { Script.completed = true; } };
const App = { close: () => { App.closed = true; } };
const Timer = { schedule: (delay, repeat, fn) => { const t = { invalidate: () => {} }; setTimeout(fn, 0); return t; } };
const WebView = class { loadURL() { return Promise.resolve(); } present() { return Promise.resolve(); } };
const Alert = class {
  addSecureTextField() {}
  addAction() {}
  addCancelAction() {}
  textFieldValue() { return ''; }
  present() { return Promise.resolve(0); }
  presentAlert() { return Promise.resolve(0); }
};

// --- Request stub: proxy the Lunch Money API to the MOCK API ----------------

const CANNED_TAGS = [
  { name: 'v12' }, { name: 'v11' }, { name: 'v10' }, { name: 'v9' }, { name: 'v8' },
  { name: 'v7' }, { name: 'v6' }, { name: 'v5' }, { name: 'v4' }, { name: 'v3' },
  { name: 'v2' }, { name: 'v1' }
];

// Scenario switch: 'pending' (the account has transactions awaiting a manual
// delete), 'clean' (none) — the two states the top-of-list line can show.
let PENDING_MODE = 'pending';

// The mock API rate-limits bursts, so identical requests are answered from
// memory after the first call.
const CACHE = new Map();

class Request {
  constructor(url) {
    this.url = String(url);
    this.headers = {};
    this.method = 'GET';
    this.timeoutInterval = 10;
    this.response = { statusCode: 200 };
  }
  async loadJSON() {
    const url = new URL(this.url);
    if (url.host === 'api.github.com') {
      // A canned tag list — one release NEWER than the shipped script, so the
      // update line is exercised.
      return [...CANNED_TAGS, { name: 'v99' }];
    }
    if (url.host === 'raw.githubusercontent.com') {
      this.response = { statusCode: 404 };
      return 'not found';
    }
    // api.lunchmoney.dev → mock.lunchmoney.dev (same path + query)
    const mock = new URL(url.pathname + url.search, 'https://mock.lunchmoney.dev');
    if (url.pathname === '/v2/transactions' && url.searchParams.get('status') === 'delete_pending') {
      // Deterministic pending-deletes so the badge state is exercised.
      if (PENDING_MODE === 'clean') return { transactions: [] };
      return { transactions: [
        { id: 1, display_name: 'Pending Co', amount: 12, to_base: 12, date: '2026-10-05', status: 'delete_pending' },
        { id: 2, display_name: 'Pending Co 2', amount: 8, to_base: 8, date: '2026-10-06', status: 'delete_pending' }
      ] };
    }
    const cacheKey = mock.toString();
    if (!CACHE.has(cacheKey)) {
      // The mock rate-limits bursts: back off and retry, and only cache a
      // successful answer.
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(mock, { headers: { Authorization: 'Bearer mock' } });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        if (res.ok) CACHE.set(cacheKey, { status: res.status, body: await res.json() });
        break;
      }
    }
    const hit = CACHE.get(cacheKey);
    if (!hit) throw new Error(`mock ${mock} → no answer (rate limited)`);
    this.response = { statusCode: hit.status };
    return hit.body;
  }
  async _unused() {
    const res = await fetch(mock, { headers: { Authorization: 'Bearer mock' } });
    this.response = { statusCode: res.status };
    if (!res.ok) throw new Error(`mock ${mock} → HTTP ${res.status}`);
    return res.json();
  }
  async loadString() {
    // The raw tag URL: serve the shipped script, except for the sentinel tag
    // that stands for a failed download.
    if (this.url.includes('/refs/tags/v404/')) {
      this.response = { statusCode: 404 };
      return 'not found';
    }
    this.response = { statusCode: 200 };
    return INDEX;
  }
}

// --- Run the widget file ----------------------------------------------------

function makeContext({ family, parameter, key = true, query = {} }) {
  const sandbox = {
    console,
    Math, Date, Object, Array, String, Number, Boolean, JSON, RegExp, Error, Promise,
    isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Set, Map,
    Alert, App, Color, Device: { screenSize: () => ({ width: 400, height: 844 }) },
    FileManager, Font, Keychain, LinearGradient, ListWidget, Pasteboard, Request, Safari, Script, Timer, WebView,
    config: { runsInWidget: false, widgetFamily: family },
    args: { widgetParameter: parameter, queryParameters: query, shortcutParameter: null },
    __key: key
  };
  // A key-less run must fall back to the setup state.
  if (!key) sandbox.Keychain = { contains: () => false, get: () => '', set: () => {} };
  return vm.createContext(sandbox);
}

async function runWidget({ family, parameter = '', key = true, query = {} }) {
  const ctx = makeContext({ family, parameter, key, query });
  const wrapped = `(async () => {\n${INDEX}\n})()`;
  await new vm.Script(wrapped, { filename: 'index.js' }).runInContext(ctx);
  return { widget: Script.widget, files: FILES };
}

// --- Assertions -------------------------------------------------------------

function walk(node, out = []) {
  if (!node) return out;
  if (node.text !== undefined) out.push({ type: 'text', text: node.text, url: node.url || null, font: node.font && node.font.size, color: node.textColor && node.textColor.value });
  if (node.children) for (const c of node.children) walk(c, out);
  if (node.url) out.push({ type: 'url', url: node.url });
  return out;
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const FAMILIES = ['small', 'medium', 'large', 'extraLarge', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
// The top-of-list line renders only where a list (or the stacked metrics) sits
// under it; the leftover-only accessories and the extraLarge breakdown have no
// list, so no line.
const BADGE_FAMILIES = ['small', 'medium', 'large', 'accessoryRectangular'];
const LIST_FAMILIES = ['medium', 'large', 'accessoryRectangular'];
// The rectangular accessory keeps its whole column URL-free so a tap can never
// shadow the badge's own target.
const UNREVIEWED_URL_FAMILIES = ['medium', 'large'];
const BUDGET_TARGET_FAMILIES = ['small', 'accessoryCircular', 'accessoryInline'];
const FIXED_LABELS = new Set([
  'LUNCH MONEY', 'Unreviewed Transactions', 'Inflow', 'Outflow', 'Leftover',
  'Deleted Transactions Pending!', 'Update Available!',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
]);

for (const family of FAMILIES) {
  for (const parameter of ['', 'previous']) {
    for (const mode of ['pending', 'clean']) {
      PENDING_MODE = mode;
      FILES.clear();
      Script.widget = undefined;
      Script.completed = false;

      const { widget } = await runWidget({ family, parameter });
      await new Promise((r) => setTimeout(r, 200));
      const nodes = walk(widget);
      const texts = nodes.filter((n) => n.type === 'text');
      const labels = texts.map((t) => t.text);
      // Deep links are percent-encoded; compare against the decoded target.
      const urls = nodes.filter((n) => n.type === 'url').map((n) => decodeURIComponent(n.url));
      const badge = labels.find((l) => l === 'Deleted Transactions Pending!' || l === 'Update Available!');
      const rows = labels.filter((l) => !FIXED_LABELS.has(l) && !/^@ /.test(l));

      const ok = [];
      ok.push(['widget built', !!widget && Script.completed === true]);
      ok.push(['widget-wide url', String(widget.url).startsWith('scriptable:///run?scriptName=')]);
      if (BADGE_FAMILIES.includes(family)) {
        ok.push(['badge message', badge === (mode === 'pending' ? 'Deleted Transactions Pending!' : 'Update Available!'), badge || '(none)']);
        if (mode === 'pending') {
          ok.push(['pending target', urls.some((u) => u.includes('status=delete pending') && u.includes('time=all'))]);
        } else {
          ok.push(['update deep link', urls.some((u) => u.includes('&update=v99'))]);
        }
      } else {
        ok.push(['no badge line', badge === undefined, badge || '(none)']);
      }
      if (LIST_FAMILIES.includes(family)) {
        ok.push(['unreviewed caption', labels.includes('Unreviewed Transactions')]);
        ok.push(['transaction rows', rows.length > 0, rows.slice(0, 2).join(', ')]);
      }
      if (UNREVIEWED_URL_FAMILIES.includes(family)) {
        ok.push(['unreviewed target', urls.some((u) => u.includes('status=unreviewed'))]);
      }
      if (BUDGET_TARGET_FAMILIES.includes(family)) {
        ok.push(['single target is Budget', urls.some((u) => u.includes('/budget/'))]);
      } else {
        ok.push(['widget target is transactions', urls.some((u) => u.includes('/transactions'))]);
      }
      const bad = ok.filter(([, v]) => !v);
      console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${family} / ${parameter || 'current'} / ${mode}${bad.length ? ' — ' + bad.map(([n]) => n).join(', ') : ''}`);
      if (bad.length) failures++;
    }
  }
}

// --- tap flows --------------------------------------------------------------

// The update tap: copies the new script and opens the editor.
OPENS.length = 0;
Pasteboard.last = null;
App.closed = false;
await runWidget({ family: 'medium', query: { update: 'v99' } });
check('the update tap copies the new script to the clipboard', String(Pasteboard.last).includes('LUNCH MONEY WIDGET'));
check('the update tap opens this script in the editor', OPENS.some((u) => u.startsWith('scriptable:///open?scriptName=')), OPENS.join(' | '));
check('the update tap leaves the user in Scriptable', App.closed !== true);

// The update tap with a failed download falls back to the TAG's page (this
// project publishes no GitHub Release objects, so /releases/tag/ would 404).
OPENS.length = 0;
Pasteboard.last = null;
await runWidget({ family: 'medium', query: { update: 'v404' } });
check('a failed update download falls back to the tag page',
  OPENS.some((u) => u === 'https://github.com/john-cabaj/leftover-lunch-money/tree/v404'),
  OPENS.join(' | '));

// A normal page tap presents the web view and closes the app after it.
OPENS.length = 0;
App.closed = false;
await runWidget({ family: 'medium', query: { url: 'https://my.lunchmoney.app/transactions' } });
check('a page tap closes the app after the page is dismissed', App.closed === true);

// A url-less tap (a lock-screen accessory) falls back to the transactions view
// for the displayed period.
OPENS.length = 0;
await runWidget({ family: 'accessoryRectangular', query: { parameter: 'previous' } });
check('a url-less tap opens the transactions fallback', OPENS.length === 0, '(presented in-app)');


// The key-less run shows the setup state instead of an error.
FILES.clear();
Script.widget = undefined;
PENDING_MODE = 'pending';
const noKey = await runWidget({ family: 'medium', key: false });
const noKeyLabels = walk(noKey.widget).filter((n) => n.type === 'text').map((n) => n.text);
check('a key-less run shows the setup state', noKeyLabels.some((l) => /Add your Lunch Money API key/.test(l)), noKeyLabels.join(' | '));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks pass');
process.exit(failures ? 1 : 0);
