'use strict';

// The public tree carries only its file inventory. Publishing instructions and
// private repository history stay in the staging repository.
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = 'public-files.json';
const PRIVATE_LIST = 'PUBLIC_EXPORT.txt';
const PRIVATE_PATHS = new Set([PRIVATE_LIST, 'PUBLISH_STEPS.md', 'CLAUDE.md', 'ATTRIBUTION.md', '.env']);

function validatePublicFiles(files) {
  if (!Array.isArray(files) || files.length < 10) throw new Error('Public file inventory is missing or unexpectedly small');
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !file || file.includes('\\') || path.posix.isAbsolute(file)
      || path.posix.normalize(file) !== file || file.split('/').some((part) => ['..', '.', '.git', '.githooks', 'node_modules', '.build'].includes(part))
      || PRIVATE_PATHS.has(file) || /(?:^|\/)\.env(?:\.|$)/.test(file)) {
      throw new Error('Unsafe path in public file inventory');
    }
    if (seen.has(file)) throw new Error(`Duplicate public file: ${file}`);
    seen.add(file);
  }
  return [...seen].sort();
}

function readPublicFiles(root) {
  const source = process.env.PUBLIC_EXPORT || path.join(root, PRIVATE_LIST);
  if (fs.existsSync(source)) {
    return validatePublicFiles(fs.readFileSync(source, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  }
  if (process.env.PUBLIC_EXPORT) throw new Error('The selected public file inventory does not exist');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  if (manifest.schema_version !== 1) throw new Error('Unsupported public file inventory version');
  return validatePublicFiles(manifest.files);
}

function serializePublicFiles(files) {
  return JSON.stringify({ schema_version: 1, files: validatePublicFiles(files) }, null, 2) + '\n';
}

module.exports = { readPublicFiles, serializePublicFiles, validatePublicFiles, MANIFEST };
