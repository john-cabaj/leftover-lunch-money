// Release scope: maps the changes since the last release tag to the areas
// (and therefore the domain skills) a finalize-release pass must cover.
//
// Usage:
//   node tools/release-scope.mjs            # human-readable report
//   node tools/release-scope.mjs --json     # machine-readable report
//   node tools/release-scope.mjs --tag v13  # use a different boundary
//
// The area map lives in tools/release-scope.areas.json — the single source of
// truth shared with .agents/skills/finalize-release/SKILL.md and guarded by
// test/repo-consistency.test.js.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(TOOLS_DIR, '..');
const MAP = JSON.parse(readFileSync(join(TOOLS_DIR, 'release-scope.areas.json'), 'utf8'));

// --- git helpers -------------------------------------------------------------

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
  } catch (err) {
    if (allowFail) return '';
    throw new Error(`git ${args.join(' ')} failed: ${err.message}`);
  }
}

function gitLines(args) {
  const out = git(args, { allowFail: true });
  return out.split('\n').filter((l) => l.length > 0);
}

// --- owner extraction --------------------------------------------------------

const KEYWORDS = new Set(['const', 'let', 'var', 'function', 'async', 'class', 'return', 'if', 'for', 'while', 'switch', 'export', 'default']);

// The enclosing declaration git names in a hunk header ("@@ … @@ function foo() {").
// Pull the identifier out of it; a hunk with no usable context has no owner.
function extractOwner(context) {
  if (!context) return null;
  const line = context.trim();
  const decl = line.match(/^(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/);
  if (decl) return decl[1];
  const binding = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
  if (binding) return binding[1];
  const token = line.match(/([A-Za-z_$][\w$]*)/);
  if (!token) return null;
  return KEYWORDS.has(token[1]) ? null : token[1];
}

// --- region detection --------------------------------------------------------

// index.js carries SECTION INDEX banners; each one opens a region.
function readRegions(indexSource) {
  const lines = indexSource.split('\n');
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\s{6,}([A-Z][A-Z ]{3,}(?: - .*)?)\s*$/);
    if (!m) return;
    const name = m[1].split(' - ')[0].trim();
    if (name === 'SECTION INDEX') return;
    marks.push({ name, line: i + 1 });
  });
  return {
    at(lineNo) {
      let found = null;
      for (const mark of marks) {
        if (mark.line > lineNo) break;
        found = mark;
      }
      return found ? found.name : null;
    }
  };
}

// --- diff parsing ------------------------------------------------------------

function parseHunks(diffText) {
  const hunks = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
  for (const line of diffText.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    hunks.push({
      oldStart: Number(m[1]),
      oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newCount: m[4] === undefined ? 1 : Number(m[4]),
      context: m[5].trim()
    });
  }
  return hunks;
}

// --- area index --------------------------------------------------------------

const areasBySkill = new Map();
const ownerIndex = new Map();
for (const area of MAP.areas) {
  areasBySkill.set(area.skill, area);
  for (const owner of area.owners) {
    if (!ownerIndex.has(owner)) ownerIndex.set(owner, []);
    ownerIndex.get(owner).push(area);
  }
}

function areasForSkills(skills) {
  const out = [];
  for (const skill of skills) {
    const area = areasBySkill.get(skill);
    if (area && !out.includes(area)) out.push(area);
  }
  return out;
}

// --- scope -------------------------------------------------------------------

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const tagIndex = argv.indexOf('--tag');
const forcedTag = tagIndex !== -1 ? argv[tagIndex + 1] : null;

const boundary = forcedTag || (gitLines(['describe', '--tags', '--abbrev=0', 'HEAD'])[0] || null);
const wholeWidget = !boundary;

const changedFiles = boundary
  ? gitLines(['diff', '--name-only', boundary])
  : gitLines(['ls-files']);
const untracked = gitLines(['status', '--porcelain', '-uall'])
  .filter((l) => l.startsWith('??'))
  .map((l) => l.slice(3).trim());

const indexSource = readFileSync(join(REPO, 'index.js'), 'utf8');
const regions = readRegions(indexSource);

const inScope = new Map(); // area -> { reasons: [] }
const unclassified = [];

function addArea(area, reason) {
  if (!area) return;
  if (!inScope.has(area)) inScope.set(area, { reasons: [] });
  const reasons = inScope.get(area).reasons;
  if (!reasons.includes(reason)) reasons.push(reason);
}

// index.js hunks -> owners -> areas
const indexHunks = boundary
  ? parseHunks(git(['diff', boundary, '-U0', '--', 'index.js']))
  : [];

const touched = new Set();
const removed = [];
for (const hunk of indexHunks) {
  const owner = extractOwner(hunk.context);
  const region = regions.at(hunk.newStart);
  if (!owner) {
    unclassified.push({ file: 'index.js', line: hunk.newStart, owner: null, region, hint: MAP.regions[region] || null });
    continue;
  }
  touched.add(owner);
  const areas = ownerIndex.get(owner) || [];
  if (areas.length === 0) {
    // A symbol that no longer exists in index.js was removed or renamed: the
    // addition hunk names its replacement, so this is not an open question.
    if (!new RegExp(`\\b${owner}\\b`).test(indexSource)) {
      removed.push(owner);
      continue;
    }
    unclassified.push({ file: 'index.js', line: hunk.newStart, owner, region, hint: MAP.regions[region] || null });
    continue;
  }
  const shared = areas.length > 1;
  for (const area of areas) {
    addArea(area, `${owner}${shared ? ' (shared)' : ''}`);
  }
}

// other files
for (const file of changedFiles.concat(untracked)) {
  if (file === 'index.js') continue;

  if (file === 'test/pure-core.test.js') {
    const hunks = parseHunks(boundary ? git(['diff', boundary, '-U0', '--', file]) : '');
    const lines = readFileSync(join(REPO, file), 'utf8').split('\n');
    const blocks = new Set();
    for (const hunk of hunks) {
      const end = hunk.newStart + Math.max(hunk.newCount, 1);
      for (let i = hunk.newStart - 1; i < Math.min(end, lines.length); i++) {
        for (let j = i; j >= 0; j--) {
          const m = lines[j].match(/describe\(\s*'([^']+)'/);
          if (m) { blocks.add(m[1]); break; }
        }
      }
    }
    for (const block of blocks) {
      const key = Object.keys(MAP.testBlocks)
        .filter((k) => block.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const skills = key ? MAP.testBlocks[key] : undefined;
      if (!skills) {
        unclassified.push({ file, line: 0, owner: `describe('${block}')`, region: null, hint: 'testing' });
        continue;
      }
      for (const area of areasForSkills(skills)) addArea(area, `test block '${block}'`);
      const testing = areasBySkill.get('testing');
      if (testing) addArea(testing, 'the test suite changed');
    }
    continue;
  }

  const skillMatch = file.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/);
  if (skillMatch) {
    const skill = skillMatch[1];
    if (skill === 'testing') { addArea(areasBySkill.get('testing'), 'the testing skill changed'); continue; }
    if (skill === 'finalize-release') continue; // workflow doc: no domain area
    const area = areasBySkill.get(skill);
    if (area) { addArea(area, 'its skill doc changed'); continue; }
    unclassified.push({ file, line: 0, owner: skill, region: null, hint: null });
    continue;
  }

  if (file.startsWith('tools/')) {
    const name = file.split('/').pop();
    const skills = MAP.tools[name];
    if (skills === undefined) {
      unclassified.push({ file, line: 0, owner: name, region: null, hint: 'testing' });
      continue;
    }
    for (const area of areasForSkills(skills)) addArea(area, 'the tool covering it changed');
    continue;
  }

  // README.md, CHANGELOG.md, AGENTS.md, hooks: docs and workflow, no domain area
}

// --- report ------------------------------------------------------------------

const scope = {
  boundary,
  wholeWidget,
  changedFiles: [...new Set(changedFiles.concat(untracked))],
  areas: [...inScope.entries()].map(([area, { reasons }]) => ({
    area: area.area,
    skill: area.skill,
    reasons,
    verify: area.verify
  })),
  outOfScope: MAP.areas
    .filter((a) => !inScope.has(a) && a.skill !== 'testing')
    .map((a) => ({ area: a.area, skill: a.skill })),
  unclassified,
  removedOwners: removed,
  touchedOwners: [...touched].sort()
};

if (jsonMode) {
  console.log(JSON.stringify(scope, null, 2));
  process.exit(0);
}

const line = (c = '-') => c.repeat(78);
console.log(line('='));
console.log('RELEASE SCOPE');
console.log(line('='));
console.log(`boundary tag : ${boundary || '(none — whole widget)'}`);
console.log(`changed files: ${scope.changedFiles.length ? scope.changedFiles.join(', ') : '(none)'}`);
console.log('');

console.log('IN SCOPE — load these skills:');
if (scope.areas.length === 0) {
  console.log('  (nothing changed since the boundary)');
} else {
  for (const area of scope.areas) {
    console.log(`  ${area.area.padEnd(24)} ${area.skill}`);
    for (const reason of area.reasons) console.log(`      · ${reason}`);
  }
}
console.log('');

if (scope.outOfScope.length) {
  console.log('OUT OF SCOPE (untouched — no skill, no separate verification):');
  for (const area of scope.outOfScope) console.log(`  ${area.area.padEnd(24)} ${area.skill}`);
  console.log('');
}

if (scope.unclassified.length) {
  console.log('UNCLASSIFIED — classify these by hand (widen when in doubt):');
  for (const item of scope.unclassified) {
    const where = item.region ? ` [region ${item.region}]` : '';
    const hintText = item.hint ? ` → hint: ${item.hint}` : '';
    console.log(`  ${item.file}${item.line ? ':' + item.line : ''} ${item.owner || '(no owner)'}${where}${hintText}`);
  }
  console.log('');
}

if (scope.removedOwners.length) {
  console.log('REMOVED or RENAMED (the addition hunk names the replacement):');
  for (const owner of scope.removedOwners) console.log(`  ${owner}`);
  console.log('');
}

console.log('VERIFY (global floor):');
console.log('  node --check index.js');
console.log('  node --test test/*.test.js');
console.log('');
console.log('VERIFY (per in-scope area):');
for (const area of scope.areas) {
  for (const cmd of area.verify) console.log(`  [${area.skill}] ${cmd}`);
}
console.log('');
console.log('Say the scope out loud before working. The user can widen it.');
