// Verify the shipped leftover math against the mock API's relative invariants.
// Runs the REAL computeLeftover region out of index.js (extracted by marker).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'index.js'), 'utf8');
const slice = (a, b) => {
  const s = INDEX.indexOf(a);
  const e = INDEX.indexOf(b);
  if (s === -1 || e === -1 || e <= s) throw new Error(`markers: ${a} -> ${b}`);
  return INDEX.slice(s, e);
};

const ctx = vm.createContext({ Math, Date, Object, Array, String, Number, isFinite, isNaN });
new vm.Script([
  slice('function indexCategories(categories) {', 'function formatMoney(value) {'),
  'const OUTFLOW_FIELDS = ["uncategorized", "uncategorized_recurring"];',
].join('\n')).runInContext(ctx);

const BASE = 'https://mock.lunchmoney.dev/v2';
async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: 'Bearer mock' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const start = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
const end = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));

const params = {
  start_date: start,
  end_date: end,
  include_totals: 'true',
  include_rollover_pool: 'true',
  include_exclude_from_budgets: 'true',
  include_occurrences: 'true',
  include_past_budget_dates: 'true'
};

const [summary, categories, settings] = await Promise.all([
  get('/summary', params),
  get('/categories'),
  get('/budgets/settings').catch(() => ({}))
]);

const leftover = ctx.computeLeftover(summary, categories);
if (!leftover) throw new Error('computeLeftover returned null');

const rows = ctx.categoryRows(summary, categories);
const rowSum = rows.reduce((s, r) => s + r.contribution, 0);
const uncategorized = ctx.sumBreakdownFields(summary.totals && summary.totals.outflow, ['uncategorized', 'uncategorized_recurring']);
const outflow = leftover.outflow;

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

check('outflow = category contributions + uncategorized buckets',
  near(outflow, rowSum + uncategorized),
  `outflow=${outflow.toFixed(2)} rows=${rowSum.toFixed(2)} uncategorized=${uncategorized.toFixed(2)}`);

check('leftover = inflow - outflow',
  near(leftover.savings, leftover.inflow - leftover.outflow),
  `savings=${leftover.savings.toFixed(2)} inflow=${leftover.inflow.toFixed(2)} outflow=${outflow.toFixed(2)}`);

const inflow = ctx.incomeInflow(summary, categories);
const expected = summary.totals && summary.totals.inflow && summary.totals.inflow.recurring_expected;
const rollover = (summary.rollover_pool && summary.rollover_pool.budgeted_to_base) || 0;
check('inflow = per-category max income + rollover pool',
  near(leftover.inflow, inflow + rollover),
  `inflow=${leftover.inflow.toFixed(2)} income=${inflow.toFixed(2)} rollover=${rollover.toFixed(2)}`);
if (typeof expected === 'number') {
  check('inflow lands on the summary\'s recurring_expected income',
    near(inflow, expected, 0.05),
    `income=${inflow.toFixed(2)} recurring_expected=${expected.toFixed(2)}`);
}

// Every counted category row must have a name and a finite contribution.
check('every category row is named and finite',
  rows.every((r) => r.name && Number.isFinite(r.contribution)),
  `${rows.length} rows`);

// Each counted row contributes its budget (plus overspend) when budgeted, and
// its activity when not — the shape shapeBudgetRow defines.
const rowContribOk = rows.every((r) => {
  if (r.initialBudget == null) return near(r.contribution, r.activity);
  const expected = r.available >= 0 ? r.initialBudget : r.initialBudget - r.available;
  return near(r.contribution, expected);
});
check('every row contributes its budget (+overspend) or its activity',
  rowContribOk, `${rows.length} rows`);

// Group rows and their budgeted children are mutually exclusive: never both a
// group and one of its children in the same counted set.
const counted = ctx.countedEntries(summary, categories, false);
const countedIds = new Set(counted.entries.map((e) => e.category_id));
const groupChildOverlap = (() => {
  const info = ctx.indexCategories(categories).info;
  const childrenOf = new Map();
  for (const entry of summary.categories || []) {
    const c = info[entry.category_id] || {};
    if (c.groupId == null) continue;
    if (!childrenOf.has(c.groupId)) childrenOf.set(c.groupId, []);
    childrenOf.get(c.groupId).push(entry.category_id);
  }
  for (const [groupId, kids] of childrenOf) {
    if (countedIds.has(groupId) && kids.some((k) => countedIds.has(k))) return `${groupId}/${kids.join(',')}`;
  }
  return null;
})();
check('a group and its children never both count', groupChildOverlap === null,
  groupChildOverlap || `no overlap (counted: ${countedIds.size})`);

console.log('\nperiod', start, '→', end, '| settings:', JSON.stringify(settings).slice(0, 120));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} invariant(s) FAILED` : '\nall invariants hold');
process.exit(failed.length ? 1 : 0);
