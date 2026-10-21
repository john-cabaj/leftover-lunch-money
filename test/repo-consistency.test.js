// Guards the release-scope map against drift.
//
// The map in tools/release-scope.areas.json decides which domain skills a
// finalize-release pass loads. If it drifts from index.js, a release silently
// reviews the wrong areas — the failure mode the scoped workflow exists to
// prevent. These checks make that drift loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'index.js'), 'utf8');
const MAP = JSON.parse(readFileSync(join(REPO, 'tools/release-scope.areas.json'), 'utf8'));
const SKILL = readFileSync(join(REPO, '.opencode/skills/finalize-release/SKILL.md'), 'utf8');
const TEST_FILE = readFileSync(join(REPO, 'test/pure-core.test.js'), 'utf8');

// Every top-level declaration in index.js: functions and SCREAMING_CASE consts.
function topLevelSymbols(source) {
  const symbols = new Set();
  for (const line of source.split('\n')) {
    const fn = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fn) { symbols.add(fn[1]); continue; }
    const konst = line.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
    if (konst) symbols.add(konst[1]);
  }
  return symbols;
}

const symbols = topLevelSymbols(INDEX);
const owners = new Map();
for (const area of MAP.areas) {
  for (const owner of area.owners) {
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(area.area);
  }
}

test('every owner in the area map exists in index.js', () => {
  const missing = [...owners.keys()].filter((owner) => !symbols.has(owner));
  assert.deepEqual(missing, [], `stale owners in the map: ${missing.join(', ')}`);
});

test('every top-level symbol in index.js belongs to an area', () => {
  const unmapped = [...symbols].filter((symbol) => !owners.has(symbol)).sort();
  assert.deepEqual(
    unmapped,
    [],
    `index.js symbols with no area — add them to tools/release-scope.areas.json: ${unmapped.join(', ')}`
  );
});

test('shared owners are listed in exactly the areas that own them', () => {
  const shared = [...owners.entries()].filter(([, areas]) => areas.length > 1);
  for (const [owner, areas] of shared) {
    const expected = MAP.areas.filter((a) => a.owners.includes(owner)).map((a) => a.area);
    assert.deepEqual(areas.slice().sort(), expected.slice().sort(), `owner ${owner}`);
  }
});

test('every area points at a skill that exists', () => {
  for (const area of MAP.areas) {
    const path = join(REPO, '.opencode/skills', area.skill, 'SKILL.md');
    assert.ok(existsSync(path), `missing skill file for "${area.area}": ${path}`);
  }
});

test('every area has at least one verification command', () => {
  for (const area of MAP.areas) {
    assert.ok(Array.isArray(area.verify) && area.verify.length > 0, `area "${area.area}" has no verify command`);
  }
});

test('the finalize-release skill lists the same areas as the map', () => {
  const skillAreas = [...SKILL.matchAll(/^\s*\|\s*([^|]+?)\s*\|\s*`([a-z-]+)`\s*\|/gm)]
    .map((m) => ({ area: m[1].trim(), skill: m[2].trim() }))
    .filter((entry) => entry.skill !== 'testing');
  const mapAreas = MAP.areas
    .filter((a) => a.skill !== 'testing')
    .map((a) => ({ area: a.area, skill: a.skill }));
  assert.deepEqual(skillAreas, mapAreas, 'the skill table and the map disagree');
});

test('every test block named in the map exists in the suite', () => {
  const describes = [...TEST_FILE.matchAll(/describe\(\s*'([^']+)'/g)].map((m) => m[1]);
  for (const key of Object.keys(MAP.testBlocks)) {
    assert.ok(
      describes.some((d) => d.startsWith(key)),
      `the map names a test block that no longer exists: '${key}'`
    );
  }
});

test('every describe block in the suite is mapped to an area', () => {
  const describes = [...TEST_FILE.matchAll(/describe\(\s*'([^']+)'/g)].map((m) => m[1]);
  const unmapped = describes.filter((d) => {
    const key = Object.keys(MAP.testBlocks).filter((k) => d.startsWith(k));
    return key.length === 0;
  });
  assert.deepEqual(unmapped, [], `test blocks with no area: ${unmapped.join(', ')}`);
});

test('the scope tool runs and reports a coherent scope', (t) => {
  let gitDir;
  try {
    gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: REPO, encoding: 'utf8' });
  } catch {
    t.skip('not a git checkout');
    return;
  }
  assert.ok(gitDir, 'git dir');

  const out = execFileSync('node', [join(REPO, 'tools/release-scope.mjs'), '--json'], {
    cwd: REPO,
    encoding: 'utf8'
  });
  const scope = JSON.parse(out);
  assert.ok(typeof scope.boundary === 'string' && scope.boundary, 'a boundary tag');
  assert.ok(Array.isArray(scope.changedFiles), 'changed files');
  assert.ok(Array.isArray(scope.areas), 'in-scope areas');
  assert.ok(Array.isArray(scope.outOfScope), 'out-of-scope areas');
  assert.ok(Array.isArray(scope.unclassified), 'unclassified hunks');
  // Every area the tool reports must exist in the map, and carry its skill.
  const known = new Set(MAP.areas.map((a) => a.area));
  for (const area of scope.areas) {
    assert.ok(known.has(area.area), `unknown area: ${area.area}`);
    assert.ok(area.skill, `no skill for ${area.area}`);
  }
});
