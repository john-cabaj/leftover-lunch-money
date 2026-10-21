// Probes the live update check: what the widget would tell a user right now.
//
// Usage: node tools/check-update.mjs [installed-version ...]
//
// Reads the real tagVersion/newestTag/isNewerVersion out of index.js, asks
// GitHub for the repo's tags, and reports the notice for each installed
// version. Also checks that the newest tag's raw script URL actually exists —
// a tag that is not pushed yet is invisible to the widget AND breaks the
// README's install link.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(REPO, 'index.js'), 'utf8');
const start = INDEX.indexOf('function tagVersion(tag) {');
const end = INDEX.indexOf('// GET request against the Lunch Money API:');
if (start === -1 || end === -1) throw new Error('the update-check markers moved — update this tool');
const ctx = vm.createContext({ Math, Array, String, Number, parseInt, RegExp });
new vm.Script(INDEX.slice(start, end)).runInContext(ctx);

const REPO_SLUG = 'john-cabaj/leftover-lunch-money';
const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/tags?per_page=100`, {
  headers: { 'User-Agent': 'leftover-lunch-money-widget' }
});
const tags = await res.json();
const newest = ctx.newestTag(tags);

const installed = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (installed.length === 0) {
  const scriptVersion = INDEX.match(/const SCRIPT_VERSION = "([^"]+)"/);
  installed.push(scriptVersion ? scriptVersion[1] : 'v0');
  installed.push('v12');
}

console.log('API status        :', res.status);
console.log('tags returned     :', Array.isArray(tags) ? tags.length : '(not a tag list)');
console.log('newestTag         :', newest);
for (const version of installed) {
  const notice = ctx.isNewerVersion(newest, version) ? `notice → ${newest}` : '(no notice)';
  console.log(`installed ${version.padEnd(6)}:`, notice);
}

// The raw URL the widget downloads from (and the README installs from).
if (newest) {
  const raw = `https://raw.githubusercontent.com/${REPO_SLUG}/refs/tags/${newest}/index.js`;
  const head = await fetch(raw, { method: 'HEAD' });
  console.log('raw download      :', head.status, raw);
  if (!head.ok) {
    console.log('');
    console.log(`The ${newest} tag is not reachable at its raw URL.`);
    console.log('Until it is pushed, the install link 404s and the update notice reaches nobody.');
  }
}
