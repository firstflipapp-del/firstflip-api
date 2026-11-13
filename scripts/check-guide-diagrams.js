#!/usr/bin/env node
'use strict';

// The guides are read as much for their diagrams as for their prose — a flow a developer copies off the page is a
// contract. Mermaid is plain text, so a page that loses a bracket, drops a closing fence, or renames a node in an
// edge but not in its box still *renders*: it renders an error box, a bare `B` where the label was, or the rest of
// the page swallowed into one code block. This gate reads the fences the way the renderer does and refuses those
// four shapes, plus the silent one — a page that simply has no diagram any more.
//
// Scope is the same as the path check's: `guides/` plus README.md, the pages that go out publicly. The graph types
// allowed are the three this repository actually draws. `--self-test` seeds one break per rule and fails if any
// rule catches none of them, so a passing run means the reader works, not only that the pages do.
//
//   node scripts/check-guide-diagrams.js [--self-test]
//   exit 0  every block parses and every page in scope carries at least one diagram
//   exit 1  a broken block, a page without a diagram, or a self-test rule that caught nothing
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const GRAPH_TYPES = /^flowchart (LR|TB|TD|RL|BT)$|^stateDiagram-v2$|^sequenceDiagram$/;

const fences = (text, lang) => [...text.matchAll(new RegExp('^```' + lang + '\\n([\\s\\S]*?)^```$', 'gm'))].map((m) => m[1]);

// `"…"` is a mermaid quoted label and may hold anything but a closing double quote; strip it before counting
// brackets or reading ids, or a label like `("POST /x (:id)")` would read as unbalanced and `["a > b"] --> c`
// would read as an undeclared node called `b`.
const stripLabels = (line) => line.replace(/"[^"]*"/g, '""');
const BALANCE = [['[', ']'], ['(', ')'], ['{', '}']];

/** One broken page or block → a line of output; a clean one → nothing. */
function inspect(rel, text) {
  const problems = [];
  const openFences = [...text.matchAll(/^```/gm)].length;
  if (openFences % 2) problems.push(`${rel}: an unclosed code fence — everything after it renders inside the block`);

  const blocks = fences(text, 'mermaid');
  if (!blocks.length) problems.push(`${rel}: no mermaid diagram — the page stopped explaining itself visually`);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const head = lines[0] || '';
    if (!GRAPH_TYPES.test(head)) {
      problems.push(`${rel}: a diagram opens with "${head.slice(0, 40)}" — draw a flowchart, a stateDiagram-v2 or a sequenceDiagram`);
      continue;
    }
    for (const line of lines.slice(1)) {
      for (const [open, close] of BALANCE) {
        const o = [...stripLabels(line)].filter((c) => c === open).length;
        const c = [...stripLabels(line)].filter((c2) => c2 === close).length;
        if (o !== c) problems.push(`${rel}: "${line.slice(0, 60)}" has ${o} ${open} and ${c} ${close} — the node shape never closes`);
      }
    }
    if (!head.startsWith('stateDiagram') && !head.startsWith('sequenceDiagram')) {
      // A bare id in an edge still draws, as a box labelled with its own id. Every id in the block must be given a
      // readable shape somewhere, or the picture is unreadable in exactly the way a typo is. Ids are read off the
      // label-stripped line, so a `>` or a bracket inside a label cannot be mistaken for graph syntax.
      const declared = new Set(
        [...block.split('\n').map(stripLabels).join('\n').matchAll(/(^|\s|>)([A-Za-z_][\w-]*)[[({]/g)].map((m) => m[2]),
      );
      const used = new Set();
      for (const raw of lines.slice(1)) {
        if (/^(classDef|style|subgraph|direction|click|linkStyle|class|%%)/.test(raw)) continue;
        const line = stripLabels(raw);
        for (const m of line.matchAll(/(^|\s)([A-Za-z_][\w-]*)\s*(?=[\[{(])|(?<=[>\]\)\}])\s*([A-Za-z_][\w-]*)/g)) {
          used.add(m[2] || m[3]);
        }
      }
      for (const id of used) {
        if (!id || id === head || declared.has(id)) continue;
        problems.push(`${rel}: "${id}" appears in an edge but is never drawn with a label — the box will read "${id}"`);
      }
    }
  }
  return problems;
}

/** A page whose only break is a rule the reader cannot see must fail the self-test, or the reader is decorative. */
function selfTest() {
  const good = '```mermaid\nflowchart LR\n  A["first"] -->|"go"| B["second"]\n```\n';
  const seeds = [
    ['unclosed fence', '```mermaid\nflowchart LR\n  A["x"] --> B["y"]\n'],
    ['unknown graph type', '```mermaid\ngraphwise LR\n  A["x"] --> B["y"]\n```\n'],
    ['unbalanced shape', '```mermaid\nflowchart LR\n  A["x" --> B["y"]\n```\n'],
    ['undrawn node', '```mermaid\nflowchart LR\n  A["first"] --> Z\n```\n'],
    ['no diagram at all', '# A page\n\nprose only, nothing drawn\n'],
  ];
  const problems = [];
  if (inspect('seed', good).length) problems.push('self-test: the clean seed was reported — the reader distrusts valid diagrams');
  for (const [name, page] of seeds) {
    if (!inspect('seed', page).length) problems.push(`self-test: nothing caught the ${name} seed — that rule is not working`);
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const problems = selfTest();
  if (problems.length) {
    console.error(`check-guide-diagrams self-test: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('check-guide-diagrams self-test: 5 seeded breaks caught, 1 clean page passed untouched.');
} else {
  const exported = require('./public-files').readPublicFiles(root);

  const pages = exported.filter((p) => p.startsWith('guides/') || p === 'README.md');
  if (pages.length < 10) die(`only ${pages.length} exported pages resolved from the public file inventory — the export list changed shape`);

  const problems = selfTest();
  if (problems.length) {
    console.error('check-guide-diagrams: the reader itself is broken, so the pages are not scored');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  let blocks = 0;
  const found = [];
  for (const rel of pages) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      found.push(`${rel}: exported but missing from the tree`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    blocks += fences(text, 'mermaid').length;
    found.push(...inspect(rel, text));
  }

  const unique = [...new Set(found)];
  if (unique.length) {
    console.error(`check-guide-diagrams: ${unique.length} problem(s)`);
    for (const p of unique) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `check-guide-diagrams: ${blocks} diagrams across ${pages.length} exported pages every one of which carries at least one, all parsing; 5 seeded breaks caught by the self-test.`,
  );
}

function die(message) {
  console.error(`check-guide-diagrams: ${message}`);
  process.exit(1);
}
