'use strict';

// Pure-logic tests for index.js. The widget file cannot itself be required: it
// evaluates Scriptable globals (new Font, Color, config, …) at load and runs
// top-level await. So the pure functions are extracted from the real source by
// byte-range and evaluated in a shared VM context. This keeps the tests pinned
// to the actual code — no duplicated logic to drift.
//
// The last two regions are the widget-LAYOUT fit math (line-height factors +
// FAMILY_LAYOUTS + the list budgets) and run against a stub Device.screenSize()
// and a Font stub with no .lineHeight (so the code walks its shipped fallback
// factors). See the "widget layout (deterministic fit math)" spec at the end.
//
// Run: `node --test test/`

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function slice(startMarker, endMarker) {
  const s = INDEX.indexOf(startMarker);
  const e = INDEX.indexOf(endMarker);
  if (s === -1 || e === -1 || e <= s) {
    throw new Error(`slice markers not found (or inverted): "${startMarker}" → "${endMarker}"`);
  }
  return INDEX.slice(s, e);
}

const REGIONS = [
  slice('function buildQueryString(params) {', '/****************************************************\n             LEFTOVER CALCULATION\n*****************************************************/'),
  slice('function indexCategories(categories) {', 'function formatMoney(value) {'),
  slice('function formatMoney(value) {', '/****************************************************\n             STORAGE\n*****************************************************/'),
  slice('function carryForwardSideList(status, value, prevValue, prevUpdatedAt, now) {', '// GET request against the Lunch Money API:'),
  slice('function periodPathParts(data) {', '// Field of the /summary totals breakdown that feeds the outflow side'),
  slice('const LINE_HEIGHT_FACTOR = 1.15;', 'const LAYOUT_RENDERERS = {'),
  slice('function listHeightBudget(data, config) {', 'function smallDetailSize(config, fallback) {'),
];

const OBJ = (value) => Object.defineProperty({}, 'x', { value, enumerable: true }).x;
const TERM = {};

const BASE_GLOBALS = { Math, Date, Object, Array, String, Number, isFinite, isNaN, encodeURIComponent };

// Single source for a named constant literal in index.js (`const NAME = value;`),
// so the sandbox is provisioned with the real file values instead of copies.
function srcConst(name) {
  const match = INDEX.match(new RegExp(`^const ${name} = ([^;]+);`, 'm'));
  if (!match) throw new Error(`const ${name} not found in index.js`);
  const raw = match[1].trim();
  return /^['"]/.test(raw) ? JSON.parse(raw) : Number(raw);
}

// formatMoney is extracted on its own first so MAX_MONEY (the widest figure the
// layout clamps against) is derived from the real formatter: the layout regions
// call smallAmountFont() during module init, before the full context mounts.
const MONEY_CONTEXT = vm.createContext({ ...BASE_GLOBALS });
new vm.Script(slice('function formatMoney(value) {', '/****************************************************\n             STORAGE\n*****************************************************/')).runInContext(MONEY_CONTEXT);
const MAX_MONEY = vm.runInContext('formatMoney(99999)', MONEY_CONTEXT);

// One fresh VM context per (virtual) device screen. The layout regions resolve
// container sizes from Device.screenSize() and line heights from Font.lineHeight;
// here the Font stub has no .lineHeight, so the code uses its shipped fallback
// factors — exactly what runtimes without Font.lineHeight use on device.
function buildContext(screen) {
  const sandbox = {
    OUTFLOW_FIELDS: OBJ(['uncategorized', 'uncategorized_recurring']),
    MONTHS: OBJ([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ]),
    MONO_GLYPH_WIDTH: OBJ(0.6),
    WEB_APP_URL: OBJ('https://my.lunchmoney.app'),
    SHOW_PREVIOUS_PERIOD: OBJ(false),
    Script: OBJ({ name: () => 'index' }),
    MAX_MONEY: OBJ(MAX_MONEY),
    FONT_NAME: OBJ(srcConst('FONT_NAME')),
    MONO_FONT_NAME: OBJ(srcConst('MONO_FONT_NAME')),
    MONO_FONT_BOLD: OBJ(srcConst('MONO_FONT_BOLD')),
    Font: OBJ(function Font(name, size) { this.name = name; this.size = size; }),
    Device: OBJ({ screenSize: () => screen }),
    ...BASE_GLOBALS
  };
  const context = vm.createContext(sandbox);
  new vm.Script(REGIONS.join('\n')).runInContext(context);
  return context;
}

function loadPureLogic() {
  const context = buildContext({ width: 400, height: 844 });
  return {
    buildQueryString: context.buildQueryString,
    periodPathParts: context.periodPathParts,
    periodParams: context.periodParams,
    periodIsFullMonth: context.periodIsFullMonth,
    budgetTapUrl: context.budgetTapUrl,
    transactionPageUrl: context.transactionPageUrl,
    appDeepLink: context.appDeepLink,
    unreviewedTapUrl: context.unreviewedTapUrl,
    deletePendingTapUrl: context.deletePendingTapUrl,
    transactionsTapUrl: context.transactionsTapUrl,
    updateTapUrl: context.updateTapUrl,
    formatMoney: context.formatMoney,
    formatDateString: context.formatDateString,
    parseIsoDate: context.parseIsoDate,
    addBudgetPeriod: context.addBudgetPeriod,
    addMonthsClamped: context.addMonthsClamped,
    getBudgetPeriodForDate: context.getBudgetPeriodForDate,
    getCurrentBudgetPeriod: context.getCurrentBudgetPeriod,
    getPeriodRange: context.getPeriodRange,
    periodLabelFor: context.periodLabelFor,
    summaryOccurrences: context.summaryOccurrences,
    mostOverlappingOccurrence: context.mostOverlappingOccurrence,
    reconcilePeriodRange: context.reconcilePeriodRange,
    indexCategories: context.indexCategories,
    categoryRows: context.categoryRows,
    incomeInflow: context.incomeInflow,
    computeLeftover: context.computeLeftover,
    sumBreakdownFields: context.sumBreakdownFields,
    shouldCountEntry: context.shouldCountEntry,
    carryForwardSideList: context.carryForwardSideList,
    sideListUpdatedAt: context.sideListUpdatedAt,
  };
}

const pure = loadPureLogic();

const closeTo = (actual, expected, eps = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= eps,
  `expected ${actual} to be within ${eps} of ${expected}`
);

// Period objects are created in the VM realm, whose prototypes differ from the
// test realm's; map them into plain shadows before comparing.
const period = (p) => (p ? { start_date: p.start_date, end_date: p.end_date } : p);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Faithful Lunch Money shapes: a group (Transportation) carrying its own budget
// with a budgeted child (Fuel), unbudgeted spending categories, a
// budget-excluded-but-counted category (Charity), income categories (one
// over-performing, Business Income without a budget), and a transfer category
// (income + exclude_from_totals) that must never count.
const FIXTURE_CATEGORIES = {
  categories: [
    { id: 315170, name: 'Transportation', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: true, group_id: null, children: [
      { id: 315174, name: 'Fuel', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: 315170, children: [] }
    ] },
    { id: 315177, name: 'Restaurants', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 315162, name: 'Groceries', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 315175, name: 'Subscriptions', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 315164, name: 'Insurance', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 315628, name: 'Shopping', is_income: false, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 315163, name: 'Charity', is_income: false, exclude_from_budget: true, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 86, name: 'Transfers', is_income: true, exclude_from_budget: false, exclude_from_totals: true, is_group: false, group_id: null, children: [] },
    { id: 83, name: 'Business Income', is_income: true, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
    { id: 88, name: 'W2 Income', is_income: true, exclude_from_budget: false, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
  ]
};

const FIXTURE_SUMMARY = {
  totals: {
    outflow: {
      linked_money_activity: 100,
      financial_assistance_activity: 0,
      uncategorized: 42.5,
      uncategorized_recurring: 7.5
    },
    inflow: { recurring_expected: 3351.68 }
  },
  rollover_pool: { budgeted_to_base: 1200 },
  categories: [
    { category_id: 315170, totals: { budgeted: 300, other_activity: 0, recurring_activity: 0, available: 300 } },
    { category_id: 315174, totals: { budgeted: 250, other_activity: 25.69, recurring_activity: 0, available: 224.31 } },
    { category_id: 315177, totals: { budgeted: null, other_activity: 156.64, recurring_activity: 0, available: null } },
    { category_id: 315162, totals: { budgeted: null, other_activity: 329.14, recurring_activity: 0, available: null } },
    { category_id: 315175, totals: { budgeted: 150, other_activity: 0, recurring_activity: 0, available: 150 } },
    { category_id: 315164, totals: { budgeted: 200, other_activity: 50, recurring_activity: 4.13, available: 145.87 } },
    { category_id: 315628, totals: { budgeted: 250, other_activity: 424.8, recurring_activity: 0, available: -174.8 } },
    { category_id: 315163, totals: { budgeted: 100, other_activity: 50, recurring_activity: 0, available: 50 } },
    { category_id: 86, totals: { budgeted: null, other_activity: 25.69, recurring_activity: 0, available: null } },
    { category_id: 83, totals: { budgeted: null, other_activity: 0, recurring_activity: 850, available: null } },
    { category_id: 88, totals: { budgeted: 400, other_activity: 0, recurring_activity: 2501.68, available: -2101.68 } }
  ]
};

describe('formatMoney', () => {
  test('formats positives, negatives, zero', () => {
    assert.equal(pure.formatMoney(847.22), '$847.22');
    assert.equal(pure.formatMoney(-1428.47), '-$1,428.47');
    assert.equal(pure.formatMoney(0), '$0.00');
    assert.equal(pure.formatMoney(1234567.89), '$1,234,567.89');
  });
  test('handles non-finite input', () => {
    assert.equal(pure.formatMoney(NaN), '$0.00');
    assert.equal(pure.formatMoney(Infinity), '$0.00');
    assert.equal(pure.formatMoney(undefined), '$0.00');
  });
});

describe('computeLeftover', () => {
  const result = pure.computeLeftover(FIXTURE_SUMMARY, FIXTURE_CATEGORIES);

  test('income is per-category max of budget vs realized, plus rollover', () => {
    closeTo(result.inflow, 3351.68 + 1200);
    closeTo(result.inflow, 4551.68);
  });
  test('income land on the summary recurring_expected figure', () => {
    closeTo(pure.incomeInflow(FIXTURE_SUMMARY, FIXTURE_CATEGORIES), 3351.68);
  });
  test('outflow sums category contributions plus only the uncategorized buckets', () => {
    closeTo(result.outflow, 1660.58);
  });
  test('leftover = inflow − outflow', () => {
    closeTo(result.savings, 2891.10);
  });
  test('outflow rows + uncategorized buckets = total outflow', () => {
    const rows = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES)
      .reduce((sum, row) => sum + row.contribution, 0);
    const uncategorized = pure.sumBreakdownFields(FIXTURE_SUMMARY.totals.outflow, ['uncategorized', 'uncategorized_recurring']);
    closeTo(rows + uncategorized, result.outflow);
  });
  test('over-budget category contributes budget + overspend (Shopping)', () => {
    const row = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES).find((r) => r.name === 'Shopping');
    closeTo(row.contribution, 424.8);
  });
  test('unbudgeted categories contribute their activity', () => {
    const restaurants = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES).find((r) => r.name === 'Restaurants');
    const groceries = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES).find((r) => r.name === 'Groceries');
    closeTo(restaurants.contribution, 156.64);
    closeTo(groceries.contribution, 329.14);
  });
  test('exclude_from_totals categories never count (Transfers, income side)', () => {
    const rows = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES);
    assert.ok(!rows.some((r) => r.name === 'Transfers'));
  });
  test('exclude_from_budget alone never excludes a category (Charity still counts)', () => {
    const charity = pure.categoryRows(FIXTURE_SUMMARY, FIXTURE_CATEGORIES).find((r) => r.name === 'Charity');
    closeTo(charity.contribution, 100);
  });
  test('returns null when there is no summary to compute from', () => {
    assert.equal(pure.computeLeftover({}, FIXTURE_CATEGORIES), null);
    assert.equal(pure.computeLeftover(undefined, FIXTURE_CATEGORIES), null);
  });
  test('returns null when either response lacks its categories array', () => {
    assert.equal(pure.computeLeftover(FIXTURE_SUMMARY, {}), null);
    assert.equal(pure.computeLeftover(FIXTURE_SUMMARY, undefined), null);
    assert.equal(pure.computeLeftover({ categories: 'nope' }, FIXTURE_CATEGORIES), null);
  });
});

describe('carryForwardSideList (side-list fetch fallback)', () => {
  const prevRows = [{ payee: 'Coffee', amount: 4.5, date: '2026-10-01' }];
  const freshRows = [{ payee: 'Bagel' }];

  test('a successful fetch replaces the value and stamps the fetch time', () => {
    const r = pure.carryForwardSideList('ok', freshRows, prevRows, 1000, 2000);
    assert.equal(r.value, freshRows);
    assert.equal(r.status, 'ok');
    assert.equal(r.updatedAt, 2000);
  });
  test('a successful empty fetch clears the list as real information', () => {
    const r = pure.carryForwardSideList('empty', [], prevRows, 1000, 2000);
    assert.equal(r.value.length, 0);
    assert.equal(r.status, 'empty');
    assert.equal(r.updatedAt, 2000);
  });
  test('a failed fetch keeps the previous value and its original timestamp', () => {
    const r = pure.carryForwardSideList('failed', [], prevRows, 1000, 2000);
    assert.equal(r.value, prevRows);
    assert.equal(r.status, 'stale');
    assert.equal(r.updatedAt, 1000);
  });
  test('a failed fetch never stamps a fresh time onto stale data', () => {
    const r = pure.carryForwardSideList('failed', [], prevRows, 1000, 2000);
    assert.equal(r.updatedAt, 1000);
  });
  test('a failed count fetch carries a legitimate zero forward (badge hides)', () => {
    const r = pure.carryForwardSideList('failed', 0, 0, 1000, 2000);
    assert.equal(r.value, 0);
    assert.equal(r.status, 'stale');
    assert.equal(r.updatedAt, 1000);
  });
  test('a failed fetch with nothing to fall back on reports failed', () => {
    const r1 = pure.carryForwardSideList('failed', [], null, null, 2000);
    assert.equal(r1.value.length, 0);
    assert.equal(r1.status, 'failed');
    const r2 = pure.carryForwardSideList('failed', 0, undefined, null, 2000);
    assert.equal(r2.value, 0);
    assert.equal(r2.status, 'failed');
  });
  test('a previous value without a timestamp is not treated as carryable', () => {
    const r = pure.carryForwardSideList('failed', [], prevRows, null, 2000);
    assert.equal(r.value.length, 0);
    assert.equal(r.status, 'failed');
  });
});

describe('sideListUpdatedAt (per-field recency fallback)', () => {
  const prev = { lastUpdated: 100, unreviewedUpdatedAt: 50, deletePendingUpdatedAt: 25 };

  test('prefers the per-field stamp when present', () => {
    assert.equal(pure.sideListUpdatedAt(prev, 'unreviewedUpdatedAt'), 50);
    assert.equal(pure.sideListUpdatedAt(prev, 'deletePendingUpdatedAt'), 25);
  });
  test('falls back to the record lastUpdated when the per-field stamp is missing', () => {
    assert.equal(pure.sideListUpdatedAt(prev, 'missingUpdatedAt'), 100);
  });
  test('null without a previous record', () => {
    assert.equal(pure.sideListUpdatedAt(null, 'unreviewedUpdatedAt'), null);
  });
  test('a missing stamp on a bare record resolves to undefined (caller guards with != null)', () => {
    assert.equal(pure.sideListUpdatedAt({}, 'unreviewedUpdatedAt'), undefined);
  });
});

describe('per-category income max (over-performer not masked by under-budget)', () => {
  test('realized income counts in full against its larger budget', () => {
    const summary = {
      totals: {},
      categories: [
        { category_id: 1, totals: { budgeted: 11804.14, other_activity: 12129.38, recurring_activity: 0, available: 0 } },
        { category_id: 2, totals: { budgeted: 1331, other_activity: 0, recurring_activity: 0, available: 1331 } }
      ]
    };
    const categories = {
      categories: [
        { id: 1, is_income: true, exclude_from_totals: false, is_group: false, group_id: null, children: [] },
        { id: 2, is_income: true, exclude_from_totals: false, is_group: false, group_id: null, children: [] }
      ]
    };
    closeTo(pure.incomeInflow(summary, categories), 12129.38 + 1331);
  });
});

describe('group / child mutual exclusion', () => {
  test('group with budget and an unbudgeted child counts the group, not the child', () => {
    const categories = {
      categories: [
        { id: 10, name: 'Group', is_group: true, group_id: null, exclude_from_totals: false, is_income: false, children: [
          { id: 11, name: 'Child', is_group: false, group_id: 10, exclude_from_totals: false, is_income: false, children: [] }
        ] }
      ]
    };
    const summary = {
      totals: {},
      categories: [
        { category_id: 10, totals: { budgeted: 500, other_activity: 0, recurring_activity: 0, available: 500 } },
        { category_id: 11, totals: { budgeted: null, other_activity: 120, recurring_activity: 0, available: null } }
      ]
    };
    closeTo(pure.computeLeftover(summary, categories).outflow, 500);
  });
});

describe('addBudgetPeriod', () => {
  const mon = { budget_period_quantity: 1, budget_period_granularity: 'month' };

  test('steps across a year boundary', () => {
    const d = pure.addBudgetPeriod(new Date(2026, 11, 15), mon, 1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2027, 0, 15]);
  });
  test('negative count walks backward', () => {
    const d = pure.addBudgetPeriod(new Date(2026, 0, 15), mon, -1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2025, 11, 15]);
  });
  test('Jan 31 never overflows into March (leap year → Feb 29)', () => {
    const d = pure.addBudgetPeriod(new Date(2028, 0, 31), mon, 1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2028, 1, 29]);
  });
  test('Jan 31 never overflows into March (non-leap → Feb 28)', () => {
    const d = pure.addBudgetPeriod(new Date(2026, 0, 31), mon, 1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 1, 28]);
  });
  test('year granularity clamps Feb 29 to the prior month last day', () => {
    const yr = { budget_period_quantity: 1, budget_period_granularity: 'year' };
    const d = pure.addBudgetPeriod(new Date(2028, 1, 29), yr, 1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2029, 1, 28]);
  });
  test('quantity > 1 steps multiple periods at once', () => {
    const bimonth = { budget_period_quantity: 2, budget_period_granularity: 'month' };
    const d = pure.addBudgetPeriod(new Date(2026, 0, 15), bimonth, 1);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 2, 15]);
  });
});

describe('getBudgetPeriodForDate', () => {
  const monthly15 = {
    budget_period_anchor_date: '2026-01-15',
    budget_period_quantity: 1,
    budget_period_granularity: 'month',
    budget_use_last_day_of_month: 0
  };

  test('finds the period containing a date', () => {
    const p = pure.getBudgetPeriodForDate(monthly15, new Date(2026, 2, 20));
    assert.deepEqual(period(p), { start_date: '2026-03-15', end_date: '2026-04-14' });
  });
  test('date exactly at a boundary belongs to the period about to end', () => {
    const p = pure.getBudgetPeriodForDate(monthly15, new Date(2026, 2, 14));
    assert.deepEqual(period(p), { start_date: '2026-02-15', end_date: '2026-03-14' });
  });
  test('use_last_day_of_month stretches the period into its containing month', () => {
    const settings = { ...monthly15, budget_use_last_day_of_month: 1 };
    const p = pure.getBudgetPeriodForDate(settings, new Date(2026, 2, 20));
    assert.deepEqual(period(p), { start_date: '2026-03-15', end_date: '2026-04-30' });
  });
  test('quantity 2 months yields a bi-monthly period', () => {
    const settings = {
      budget_period_anchor_date: '2026-01-01',
      budget_period_quantity: 2,
      budget_period_granularity: 'month',
      budget_use_last_day_of_month: 0
    };
    const p = pure.getBudgetPeriodForDate(settings, new Date(2026, 3, 10));
    assert.deepEqual(period(p), { start_date: '2026-03-01', end_date: '2026-04-30' });
  });
  test('daily granularity makes every day its own period', () => {
    const settings = {
      budget_period_anchor_date: '2026-06-01',
      budget_period_quantity: 1,
      budget_period_granularity: 'day',
      budget_use_last_day_of_month: 0
    };
    const p = pure.getBudgetPeriodForDate(settings, new Date(2026, 5, 10));
    assert.deepEqual(period(p), { start_date: '2026-06-10', end_date: '2026-06-10' });
  });
  test('null when there is no custom period configured', () => {
    assert.equal(pure.getBudgetPeriodForDate({}, new Date()), null);
  });
});

describe('periodLabelFor', () => {
  test('single month → month name in caps', () => {
    assert.equal(
      pure.periodLabelFor({ budget_period_granularity: 'month' }, { start_date: '2026-06-01', end_date: '2026-06-30' }),
      'JUNE'
    );
  });
  test('straddling two months → range label', () => {
    assert.equal(
      pure.periodLabelFor({ budget_period_granularity: 'month' }, { start_date: '2026-06-15', end_date: '2026-07-14' }),
      'JUNE–JULY'
    );
  });
  test('non-month granularity → generic pay-period label', () => {
    assert.equal(
      pure.periodLabelFor({ budget_period_granularity: 'week' }, { start_date: '2026-06-01', end_date: '2026-06-07' }),
      'CURRENT PAY PERIOD'
    );
  });
});

describe('reconcilePeriodRange (API period boundaries)', () => {
  const seed = { start_date: '2026-06-01', end_date: '2026-06-30' };

  test('an occurrence equal to the seed is kept unchanged', () => {
    const summary = { categories: [{ occurrences: [{ in_range: true, start_date: '2026-06-01', end_date: '2026-06-30' }] }] };
    assert.deepEqual(period(pure.reconcilePeriodRange(summary, seed)), seed);
  });
  test('a misaligned seed is corrected to the overlapping occurrence', () => {
    const summary = { categories: [{ occurrences: [{ in_range: true, start_date: '2026-06-15', end_date: '2026-07-14' }] }] };
    assert.deepEqual(period(pure.reconcilePeriodRange(summary, seed)), {
      start_date: '2026-06-15', end_date: '2026-07-14'
    });
  });
  test('prior-period occurrences that do not overlap the seed are ignored', () => {
    const summary = { categories: [{ occurrences: [
      { in_range: false, start_date: '2026-03-01', end_date: '2026-03-31' },
      { in_range: true, start_date: '2026-06-01', end_date: '2026-06-30' }
    ] }] };
    assert.deepEqual(period(pure.reconcilePeriodRange(summary, seed)), seed);
  });
  test('falls back to the seed when no occurrences are returned', () => {
    assert.deepEqual(period(pure.reconcilePeriodRange({ categories: [] }, seed)), seed);
    assert.deepEqual(period(pure.reconcilePeriodRange({}, seed)), seed);
  });
  test('skips categories without occurrences and reads a later one', () => {
    const summary = { categories: [
      { category_id: 1 },
      { category_id: 2, occurrences: [{ in_range: true, start_date: '2026-06-15', end_date: '2026-07-14' }] }
    ] };
    assert.deepEqual(period(pure.reconcilePeriodRange(summary, seed)), {
      start_date: '2026-06-15', end_date: '2026-07-14'
    });
  });
});

describe('periodIsFullMonth (path-pinned periods)', () => {
  test('a 1st → month-end period is covered by the /YYYY/MM path', () => {
    assert.equal(pure.periodIsFullMonth({ periodStart: '2026-06-01', periodEnd: '2026-06-30' }), true);
    assert.equal(pure.periodIsFullMonth({ periodStart: '2026-02-01', periodEnd: '2026-02-28' }), true);
    assert.equal(pure.periodIsFullMonth({ periodStart: '2024-02-01', periodEnd: '2024-02-29' }), true);
  });
  test('custom, multi-month, short, and missing periods are not', () => {
    assert.equal(pure.periodIsFullMonth({ periodStart: '2026-03-15', periodEnd: '2026-04-14' }), false);
    assert.equal(pure.periodIsFullMonth({ periodStart: '2026-10-01', periodEnd: '2026-11-30' }), false);
    assert.equal(pure.periodIsFullMonth({ periodStart: '2026-06-01', periodEnd: '2026-06-29' }), false);
    assert.equal(pure.periodIsFullMonth({}), false);
  });
});

describe('tap URL builders (golden)', () => {
  const data = { periodStart: '2026-06-01', periodEnd: '2026-06-30' };

  test('budgetTapUrl: monthly period anchors on year/month', () => {
    assert.equal(
      pure.budgetTapUrl(data),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Fbudget%2F2026%2F06%2F'
    );
  });
  test('budgetTapUrl: custom period not starting on the 1st adds its start day', () => {
    assert.equal(
      pure.budgetTapUrl({ periodStart: '2026-03-15', periodEnd: '2026-04-14' }),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Fbudget%2F2026%2F03%2F15'
    );
  });
  test('budgetTapUrl: no period loaded falls back to the bare budget view', () => {
    assert.equal(
      pure.budgetTapUrl({}),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Fbudget'
    );
  });
  test('unreviewedTapUrl: unreviewed + pending, full month pinned by the path', () => {
    assert.equal(
      pure.unreviewedTapUrl(data),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%2F2026%2F06%3Fstatus%3Dunreviewed%26include_pending%3Dtrue%26match%3Dall'
    );
  });
  test('deletePendingTapUrl: every delete_pending transaction, NO date filter, webapp label with a space', () => {
    assert.equal(
      pure.deletePendingTapUrl(),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%3Fmatch%3Dall%26status%3Ddelete%20pending%26time%3Dall'
    );
  });
  test('transactionsTapUrl: full-month period carries no range, quick search bar stays', () => {
    assert.equal(
      pure.transactionsTapUrl(data),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%2F2026%2F06%3Finclude_pending%3Dtrue'
    );
  });
  test('updateTapUrl: a scriptable:///run deep-link carrying ?update=<tag>, NOT ?url=', () => {
    assert.equal(
      pure.updateTapUrl({ updateTag: 'v11' }),
      'scriptable:///run?scriptName=index&update=v11'
    );
  });
  test('transactionPageUrl: a custom period keeps its time=custom range', () => {
    assert.equal(
      pure.transactionPageUrl({ periodStart: '2026-03-15', periodEnd: '2026-04-14' }, { include_pending: true }),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%2F2026%2F03%3Fend_date%3D2026-04-14%26start_date%3D2026-03-15%26time%3Dcustom%26include_pending%3Dtrue'
    );
  });
  test('transactionPageUrl: a period spanning two whole months keeps the range too', () => {
    assert.equal(
      pure.transactionPageUrl({ periodStart: '2026-10-01', periodEnd: '2026-11-30' }, {}),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%2F2026%2F10%3Fend_date%3D2026-11-30%26start_date%3D2026-10-01%26time%3Dcustom'
    );
  });
  test('transactionPageUrl: no period loaded drops the date range but keeps filters', () => {
    assert.equal(
      pure.transactionPageUrl({}, { status: 'unreviewed' }),
      'scriptable:///run?scriptName=index&url=https%3A%2F%2Fmy.lunchmoney.app%2Ftransactions%3Fstatus%3Dunreviewed'
    );
  });
});

// ---------------------------------------------------------------------------
// Widget layout — deterministic fit spec
//
// Runs the REAL layout/fit code (FAMILY_LAYOUTS, widgetSizes, the line-height
// factors, listHeightBudget, rowFitHeight, maxUnreviewedCount) against a stub
// Device.screenSize() per known iPhone and a Font stub with no .lineHeight, so
// the code walks its shipped fallback factors — exactly the runtimes without
// Font.lineHeight the widget supports. This cannot see WidgetKit pixels, but it
// locks the calibration knobs the widget-layout skill flags: the device tables,
// per-family row pitches, Delete Pending badge reserves, the small-amount font,
// and the "rows never overflow the budget" invariant — so a silent drift fails
// `node --test` instead of needing an eye on a phone. Row counts marked with *
// are the DEVICE-VERIFIED numbers from the skill (PRO medium: 6 rows @158pt, 5
// with the badge; SE 667: 5 @148, 4 with the badge; SE 1st gen: 3 with the badge
// on its 141pt medium); the others are the fallback matrix's own values.
// ---------------------------------------------------------------------------

const LAYOUT_FNS = [
  'lineHeight', 'monoLineHeight', 'monoRegularLineHeight', 'leanLineHeight',
  'rowFitHeight', 'listHeightBudget', 'maxUnreviewedCount',
  'deletePendingBadgeHeight', 'hasDeletePending', 'hasBadgeLine', 'hasUpdate', 'smallAmountFont', 'textWidth'
];
const LAYOUT_CONSTS = ['WIDGET_SIZE', 'ACCESSORY_SIZE', 'WIDGET_INNER_WIDTH', 'LIST_COLUMN_WIDTH', 'WIDGET_HEIGHTS', 'FAMILY_LAYOUTS'];

const LAYOUT_CACHE = new Map();
function layoutFor(screen) {
  const key = screen.width + 'x' + screen.height;
  if (LAYOUT_CACHE.has(key)) return LAYOUT_CACHE.get(key);
  const ctx = buildContext(screen);
  const out = {};
  for (const name of LAYOUT_FNS) out[name] = ctx[name];
  for (const name of LAYOUT_CONSTS) out[name] = vm.runInContext(name, ctx);
  LAYOUT_CACHE.set(key, out);
  return out;
}

const DEVICE_HEIGHTS = [...new Set([
  ...[...INDEX.match(/const SPEC = \(\{([^}]+)\}/s)[1].matchAll(/(\d{3}):/g)].map((m) => +m[1]),
  ...[...INDEX.match(/const ACCESSORY_SPECS = \{([^}]+)\};/s)[1].matchAll(/(\d{3}):/g)].map((m) => +m[1])
])].sort((a, b) => b - a);
assert.ok(DEVICE_HEIGHTS.length >= 11, 'expected the known iPhone screen heights in index.js');

// Row pitch = Menlo detail-font line + ROW_GAP 1 (device-verified: Menlo 11 →
// 13 + 1 = 14pt); a Delete Pending badge reserves leanLineHeight(caption) +
// LIST_BOTTOM_SLACK at the top of the list column.
const ROW_PITCH = { medium: 14, large: 15, accessoryRectangular: 12 };
const BADGE_RESERVE = { medium: 16, large: 17, accessoryRectangular: 13 };

const LAYOUT_GROUPS = {
  MAX:    { heights: [932, 926], size: [364, 170, 170, 382], acc: [172, 76, 76], small: 22, budget: { medium: 99, large: 229, accessoryRectangular: 36 }, rows: { medium: [7, 5], large: [15, 14], accessoryRectangular: [3, 1] } },
  LG:     { heights: [896],      size: [360, 169, 169, 379], acc: [160, 72, 76], small: 22, budget: { medium: 98, large: 226, accessoryRectangular: 32 }, rows: { medium: [7, 5], large: [15, 13], accessoryRectangular: [2, 1] } },
  PRO:    { heights: [874, 852, 844], size: [338, 158, 158, 354], acc: [160, 72, 72], small: 19, budget: { medium: 87, large: 201, accessoryRectangular: 32 }, rows: { medium: [6, 5], large: [13, 12], accessoryRectangular: [2, 1] } }, // medium ✓ device-verified
  MODERN: { heights: [812, 780], size: [329, 155, 155, 345], acc: [157, 72, 72], small: 18, budget: { medium: 84, large: 192, accessoryRectangular: 32 }, rows: { medium: [6, 4], large: [12, 11], accessoryRectangular: [2, 1] } },
  PLUS:   { heights: [736],      size: [348, 159, 157, 357], acc: [170, 76, 76], small: 19, budget: { medium: 86, large: 204, accessoryRectangular: 36 }, rows: { medium: [6, 5], large: [13, 12], accessoryRectangular: [3, 1] } },
  SE:     { heights: [667],      size: [321, 148, 148, 324], acc: [153, 68, 68], small: 16, budget: { medium: 77, large: 171, accessoryRectangular: 28 }, rows: { medium: [5, 4], large: [11, 10], accessoryRectangular: [2, 1] } }, // medium ✓ device-verified
  SE1:    { heights: [568],      size: [292, 141, 141, 311], acc: [157, 72, 72], small: 14, budget: { medium: 70, large: 158, accessoryRectangular: 32 }, rows: { medium: [5, 3], large: [10, 9], accessoryRectangular: [2, 1] } } // medium badge ✓ device-verified
};

const RICH = {
  unreviewed: Array.from({ length: 40 }, (_, i) => ({ payee: 't' + i, amount: 1 })),
  deletePendingCount: 0
};
const RICH_BADGE = { ...RICH, deletePendingCount: 3 };
// An update-only record (no pending deletes) shares the same top-of-list line,
// so it must reserve the same badge height as the pending case.
const RICH_UPDATE = { ...RICH, deletePendingCount: 0, updateTag: 'v11' };
const LIST_FAMILY = ['medium', 'large', 'accessoryRectangular'];
const LIST_LAYOUT = { medium: 'review', large: 'overview', accessoryRectangular: 'accessoryRectangular' };

function layoutAt(height) {
  const L = layoutFor({ width: 400, height });
  const group = Object.values(LAYOUT_GROUPS).find((g) => g.heights.includes(height));
  return { L, group, height };
}

describe('widget layout (deterministic fit math)', () => {
  test('device tables resolve every known screen height to its spec', () => {
    for (const height of DEVICE_HEIGHTS) {
      const { L, group } = layoutAt(height);
      assert.deepEqual([L.WIDGET_SIZE.width, L.WIDGET_SIZE.small, L.WIDGET_SIZE.medium, L.WIDGET_SIZE.large], group.size);
      assert.deepEqual([L.ACCESSORY_SIZE.rectW, L.ACCESSORY_SIZE.rectH, L.ACCESSORY_SIZE.circular], group.acc);
      assert.equal(L.WIDGET_INNER_WIDTH, group.size[0] - 20);
      closeTo(L.LIST_COLUMN_WIDTH, (group.size[0] - 20) * 0.69);
      assert.equal(L.WIDGET_HEIGHTS.review, group.size[2] + 2);
      assert.equal(L.WIDGET_HEIGHTS.overview, group.size[3]);
      assert.equal(L.WIDGET_HEIGHTS.accessoryRectangular, group.acc[1]);
      assert.equal(L.smallAmountFont(), group.small);
    }
  });

  test('row pitches match the device-verified pitch and the fallback factors', () => {
    const { L } = layoutAt(844);
    assert.equal(L.monoRegularLineHeight(11), 13);
    assert.equal(L.lineHeight(12), 17);
    assert.equal(L.monoLineHeight(30), 35);
    assert.equal(L.leanLineHeight(13), 14);
    assert.equal(L.leanLineHeight(14), 15);
    assert.equal(L.rowFitHeight(L.FAMILY_LAYOUTS.medium), 14);
    assert.equal(L.rowFitHeight(L.FAMILY_LAYOUTS.large), 15);
    assert.equal(L.rowFitHeight(L.FAMILY_LAYOUTS.accessoryRectangular), 12);
    for (const family of LIST_FAMILY) assert.equal(L.rowFitHeight(L.FAMILY_LAYOUTS[family]), ROW_PITCH[family]);
  });

  test('list budgets + badge reserves match the pinned matrix (no silent drift)', () => {
    for (const height of DEVICE_HEIGHTS) {
      const { L, group } = layoutAt(height);
      for (const family of LIST_FAMILY) {
        const cfg = L.FAMILY_LAYOUTS[family];
        assert.equal(L.listHeightBudget(RICH, cfg), group.budget[family], `${height} ${family}`);
        assert.equal(L.deletePendingBadgeHeight(RICH, cfg), 0, `${height} ${family} no badge`);
        assert.equal(L.deletePendingBadgeHeight(RICH_BADGE, cfg), BADGE_RESERVE[family], `${height} ${family} reserve`);
        assert.equal(L.listHeightBudget(RICH_BADGE, cfg), group.budget[family] - BADGE_RESERVE[family], `${height} ${family} badge budget`);
      }
    }
  });

  test('fitted row counts match floor(budget / device-verified pitch)', () => {
    for (const height of DEVICE_HEIGHTS) {
      const { L, group } = layoutAt(height);
      for (const family of LIST_FAMILY) {
        const cfg = L.FAMILY_LAYOUTS[family];
        assert.equal(L.maxUnreviewedCount(RICH, cfg), group.rows[family][0], `${height} ${family} no badge`);
        assert.equal(L.maxUnreviewedCount(RICH_BADGE, cfg), group.rows[family][1], `${height} ${family} badge`);
        assert.equal(group.rows[family][0], Math.floor(group.budget[family] / ROW_PITCH[family]));
        assert.equal(group.rows[family][1], Math.floor((group.budget[family] - BADGE_RESERVE[family]) / ROW_PITCH[family]));
      }
    }
  });

  test('rows never overflow the vertical budget (badge on or off)', () => {
    for (const height of DEVICE_HEIGHTS) {
      const { L } = layoutAt(height);
      for (const family of LIST_FAMILY) {
        const cfg = L.FAMILY_LAYOUTS[family];
        const pitch = L.rowFitHeight(cfg);
        for (const data of [RICH, RICH_BADGE]) {
          const rows = L.maxUnreviewedCount(data, cfg);
          const budget = L.listHeightBudget(data, cfg);
          assert.ok(rows * pitch <= budget, `${height} ${family} ${data.deletePendingCount ? 'badge' : 'plain'}: ${rows}×${pitch} > ${budget}`);
        }
      }
    }
  });

  test('the badge is reserved only for layouts that render an unreviewed list', () => {
    for (const height of DEVICE_HEIGHTS) {
      const { L } = layoutAt(height);
      for (const [family, config] of Object.entries(L.FAMILY_LAYOUTS)) {
        const expected = LIST_LAYOUT[family] === config.layout ? BADGE_RESERVE[family] : 0;
        assert.equal(L.deletePendingBadgeHeight(RICH_BADGE, config), expected, `${height} ${family} (${config.layout})`);
      }
    }
    const { L } = layoutAt(844);
    assert.equal(L.hasDeletePending(RICH_BADGE), true);
    assert.equal(L.hasDeletePending(RICH), false);
    assert.equal(L.hasUpdate(RICH_UPDATE), true);
    assert.equal(L.hasUpdate(RICH), false);
    // pending deletes and an available update share the same line/reserve; an
    // update is only shown when nothing is pending.
    assert.equal(L.hasBadgeLine(RICH_BADGE), true);
    assert.equal(L.hasBadgeLine(RICH_UPDATE), true);
    assert.equal(L.hasBadgeLine(RICH), false);
    for (const family of LIST_FAMILY) {
      const cfg = L.FAMILY_LAYOUTS[family];
      assert.equal(
        L.deletePendingBadgeHeight(RICH_UPDATE, cfg),
        L.deletePendingBadgeHeight(RICH_BADGE, cfg),
        `${family} update reserves the same line as pending`
      );
    }
  });

  test('maxUnreviewedCount caps at the loaded items', () => {
    const { L } = layoutAt(844);
    const cfg = L.FAMILY_LAYOUTS.medium;
    const two = { ...RICH, unreviewed: RICH.unreviewed.slice(0, 2) };
    assert.equal(L.maxUnreviewedCount(two, cfg), 2);
    assert.equal(L.maxUnreviewedCount({ ...two, deletePendingCount: 3 }, cfg), 2);
  });

  test('small widget amount font: the largest size that fits width AND the three-rows budget', () => {
    const paddingY = srcConst('PADDING_Y');
    const stackSpacing = srcConst('STACK_SPACING');
    const smallCaption = srcConst('SMALL_CAPTION');
    for (const height of DEVICE_HEIGHTS) {
      const { L, group } = layoutAt(height);
      const small = L.smallAmountFont();
      assert.equal(small, group.small, `${height} amount`);
      const rowBudget = L.WIDGET_SIZE.small - paddingY - L.lineHeight(12) - stackSpacing
        - 3 * L.lineHeight(smallCaption) - 2;
      assert.ok(small * 3 * 1.15 <= rowBudget, `${height} height bound`);
      assert.ok(L.textWidth('$99,999.00', small) <= L.WIDGET_INNER_WIDTH, `${height} width bound`);
      assert.ok(
        (small + 1) * 3 * 1.15 > rowBudget || L.textWidth('$99,999.00', small + 1) > L.WIDGET_INNER_WIDTH,
        `${height} ` + (small + 1) + ' would still fit'
      );
    }
  });
});
