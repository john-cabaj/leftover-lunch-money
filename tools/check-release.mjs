// Release hygiene: the machine checks a release needs before it can be tagged.
//
// Usage:
//   node tools/check-release.mjs            # audit the newest tag
//   node tools/check-release.mjs --tag v14  # check a candidate release
//
// The checks:
//   - the script's SCRIPT_VERSION equals the release tag it ships as
//   - the README's install link points at that tag
//   - CHANGELOG.md has a `## vN — YYYY-MM-DD` entry for every release tag
//   - the tag is reachable on the remote (a local-only tag reaches nobody —
//     the repo never pushes, so this is a WARN that flags the user's handoff)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'index.js'), 'utf8');
const README = readFileSync(join(REPO, 'README.md'), 'utf8');
const CHANGELOG = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');
const REPO_SLUG = 'john-cabaj/leftover-lunch-money';

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFail) return '';
    throw new Error(`git ${args.join(' ')} failed: ${err.message}`);
  }
}

const versionOf = (tag) => Number(String(tag).replace(/^v/, ''));
const tags = git(['tag', '--list', 'v*'], { allowFail: true })
  .split('\n')
  .filter(Boolean)
  .sort((a, b) => versionOf(a) - versionOf(b));

const argv = process.argv.slice(2);
const tagIndex = argv.indexOf('--tag');
const candidate = tagIndex !== -1 ? argv[tagIndex + 1] : null;

const scriptVersion = (INDEX.match(/const SCRIPT_VERSION = "([^"]+)"/) || [])[1];
const readmeTag = (README.match(/refs\/tags\/(v[0-9]+)\//) || [])[1];

let failures = 0;
let warnings = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const warn = (msg) => { warnings++; console.log(`WARN  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);

console.log(`script SCRIPT_VERSION : ${scriptVersion}`);
console.log(`README install tag    : ${readmeTag}`);
console.log(`local tags            : ${tags.join(', ') || '(none)'}`);
console.log('');

// Every tag needs a changelog entry.
for (const tag of tags) {
  if (!new RegExp(`^## ${tag}\\b`, 'm').test(CHANGELOG)) {
    fail(`CHANGELOG.md has no "## ${tag}" entry`);
  }
}
if (!failures) ok('every release tag has a CHANGELOG.md entry');

if (candidate) {
  // A candidate release: the tag must not exist yet, and everything must point at it.
  if (tags.includes(candidate)) fail(`the tag ${candidate} already exists — bump the version or move the tag`);
  else ok(`the tag ${candidate} is free`);

  if (scriptVersion !== candidate) fail(`SCRIPT_VERSION is ${scriptVersion}, expected ${candidate}`);
  else ok(`SCRIPT_VERSION is ${candidate}`);

  if (readmeTag !== candidate) fail(`the README install link points at ${readmeTag}, expected ${candidate}`);
  else ok(`the README install link points at ${candidate}`);

  if (!new RegExp(`^## ${candidate}\\b`, 'm').test(CHANGELOG)) fail(`CHANGELOG.md has no "## ${candidate}" entry`);
  else ok(`CHANGELOG.md has a "## ${candidate}" entry`);
} else if (tags.length) {
  const newest = tags[tags.length - 1];
  if (scriptVersion === newest) ok(`SCRIPT_VERSION matches the newest tag (${newest})`);
  else warn(`SCRIPT_VERSION is ${scriptVersion} but the newest tag is ${newest} — expected mid-development`);

  if (readmeTag === newest) ok(`the README install link points at the newest tag (${newest})`);
  else warn(`the README install link points at ${readmeTag}, but the newest tag is ${newest}`);

  const remote = await fetch(`https://api.github.com/repos/${REPO_SLUG}/git/ref/tags/${newest}`, {
    headers: { 'User-Agent': 'leftover-lunch-money-widget' }
  }).catch(() => null);
  if (remote && remote.ok) {
    ok(`the tag ${newest} exists on the remote`);
  } else {
    warn(`the tag ${newest} is NOT on the remote — the install link 404s and the update notice reaches nobody until it is pushed`);
  }
}

console.log('');
console.log(failures ? `${failures} check(s) FAILED` : warnings ? `no failures (${warnings} warning(s))` : 'all checks pass');
process.exit(failures ? 1 : 0);
