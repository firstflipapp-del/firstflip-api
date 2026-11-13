#!/usr/bin/env node
'use strict';

// Every public page opens with `## Quick hints` — the short points a developer reads before the prose. The
// convention is the whole reason the pages are skimmable, so it has to be enforced: a new guide could otherwise
// ship without a block and nothing would say so. Read the export list, so the pages checked are exactly the
// pages published. No dependencies.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const exported = require('./public-files').readPublicFiles(root);

const pages = exported.filter((p) => p === 'README.md' || (p.startsWith('guides/') && p.endsWith('.md')));
assert.ok(pages.length >= 18, `Expected at least 18 public pages to sweep, found ${pages.length}`);

const missing = [];
const misplaced = [];
const thin = [];
let points = 0;

for (const page of pages) {
  const lines = fs.readFileSync(path.join(root, page), 'utf8').split('\n');
  const headings = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith('## '));
  if (!headings.some(([l]) => l === '## Quick hints')) {
    missing.push(page);
    continue;
  }
  // First section, or it is buried: a developer who has to scroll past prose to reach the points never reads them.
  if (headings[0][0] !== '## Quick hints') {
    misplaced.push(`${page}: "${headings[0][0]}" (line ${headings[0][1] + 1}) comes before it`);
    continue;
  }
  const start = headings[0][1];
  const end = headings.length > 1 ? headings[1][1] : lines.length;
  const list = lines.slice(start, end).filter((l) => /^(?:\d+\.|-) \*\*/.test(l));
  if (list.length < 5) {
    thin.push(`${page}: ${list.length} point(s)`);
    continue;
  }
  // A numbered list counts from 1 with no gap: a re-ordered or half-deleted one renumbers badly and reads as a
  // copy-paste. Bulleted blocks are unordered, so they only need the point count above.
  const numbered = list.filter((l) => /^\d+\./.test(l));
  if (numbered.length === list.length) {
    const badNumbering = numbered.filter((l, i) => Number(l.match(/^(\d+)\./)[1]) !== i + 1);
    if (badNumbering.length) thin.push(`${page}: numbering is not consecutive from 1`);
  }
  points += list.length;
}

assert.deepEqual(missing, [], 'A public page has no `## Quick hints` block');
assert.deepEqual(misplaced, [], 'A `## Quick hints` block is not the page\'s first section');
assert.deepEqual(thin, [], 'A `## Quick hints` block is too thin to be a shortcut (fewer than 5 points, or bad numbering)');

console.log(`Quick hints present: ${pages.length} public pages, each block first, ${points} points in total, all numbered from 1.`);
