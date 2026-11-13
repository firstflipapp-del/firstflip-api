#!/usr/bin/env node
// Pin the publish surface: a link inside a page that ships must land on a page that ships.
//
// The same allowlisted inventory is available in both staging and downloaded trees.
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..");
const exported = new Set(require('./public-files').readPublicFiles(repo));
const hasList = true;

// assistant/knowledge.md is a generated bundle assembled from the guides, so its links are guide-relative.
const linkBase = (rel) => (rel.startsWith("assistant/") ? "guides" : path.posix.dirname(rel));

const skip = /^(node_modules|\.build|\.git)\//;
const markdownFiles = hasList
  ? [...exported].filter((p) => /\.(md|mdx)$/.test(p))
  : fs
      .readdirSync(repo, { recursive: true, encoding: "utf8" })
      .filter((p) => /\.(md|mdx)$/.test(p) && !skip.test(p) && fs.statSync(path.join(repo, p)).isFile());

const problems = [];
for (const rel of markdownFiles) {
  const abs = path.join(repo, rel);
  // Existence is reported once, below, for every kind of exported path.
  if (!fs.existsSync(abs)) continue;
  for (const match of fs.readFileSync(abs, "utf8").matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|\/\/|data:)/.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(linkBase(rel), target));
    if (target.endsWith("/")) {
      // A folder link is a link into a shipped directory, so it must hold at least one shipped file.
      if (exported && ![...exported].some((p) => p.startsWith(resolved))) {
        problems.push(`${rel}: folder link "${target}" resolves to ${resolved}, which ships no file`);
      } else if (!fs.existsSync(path.join(repo, resolved))) {
        problems.push(`${rel}: folder link "${target}" resolves to ${resolved}, which does not exist`);
      }
      continue;
    }
    if (exported && !exported.has(resolved)) {
      problems.push(`${rel}: link "${target}" resolves to ${resolved}, which is not exported`);
      continue;
    }
    if (!fs.existsSync(path.join(repo, resolved))) {
      problems.push(`${rel}: link "${target}" resolves to ${resolved}, which does not exist`);
    }
  }
}

const mode = hasList ? `export list (${exported.size} paths)` : "published copy (no export list)";

// A link check cannot see a missing dependency: deleting one export row and adding another keeps the count and
// every link intact, while the published repo loses a script its own build calls. So pin the closure too —
// every path the list names must exist, and every script package.json invokes must be on the list.
for (const rel of exported || []) {
  if (!fs.existsSync(path.join(repo, rel))) problems.push(`${rel}: on the export list but missing from disk`);
}
if (exported) {
  const scripts = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts || {};
  for (const [name, body] of Object.entries(scripts)) {
    for (const match of body.matchAll(/(?:^|[\s&;(])node\s+((?:scripts|src)\/[^\s"'&|;)]+)/g)) {
      const invoked = path.posix.normalize(match[1]);
      if (!exported.has(invoked)) {
        problems.push(`package.json "${name}": runs ${invoked}, which is not exported`);
      }
    }
  }
}

if (problems.length) {
  console.error(`check-public-links (${mode}): ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-public-links (${mode}): ${markdownFiles.length} pages, no link lands outside the surface`);
