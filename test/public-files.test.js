'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPublicFiles, serializePublicFiles, validatePublicFiles } = require('../scripts/public-files');
const root = path.resolve(__dirname, '..');

test('the shipped inventory is identical to the selected publishing surface', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public-files.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(manifest.files, readPublicFiles(root));
  for (const privateName of ['PUBLIC_EXPORT.txt', 'PUBLISH_STEPS.md', 'CLAUDE.md', 'ATTRIBUTION.md', '.env']) {
    assert(!manifest.files.includes(privateName));
  }
  for (const required of ['scripts/public-files.js', 'scripts/check-clean-export.js', 'test/public-files.test.js', 'public-files.json']) {
    assert(manifest.files.includes(required));
  }
});

test('a downloader can load the same inventory without a private publishing list', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'firstflip-inventory-test-'));
  const previous = process.env.PUBLIC_EXPORT;
  delete process.env.PUBLIC_EXPORT;
  try {
    const files = JSON.parse(fs.readFileSync(path.join(root, 'public-files.json'), 'utf8')).files;
    fs.writeFileSync(path.join(scratch, 'public-files.json'), serializePublicFiles(files));
    assert(!fs.existsSync(path.join(scratch, 'PUBLIC_EXPORT.txt')));
    assert.deepEqual(readPublicFiles(scratch), files);
    fs.writeFileSync(path.join(scratch, 'public-files.json'), JSON.stringify({ schema_version: 2, files }));
    assert.throws(() => readPublicFiles(scratch), /version/);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_EXPORT; else process.env.PUBLIC_EXPORT = previous;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('unsafe, private or duplicated paths cannot become public export entries', () => {
  const safe = Array.from({ length: 10 }, (_, index) => `guides/example-${index}.md`);
  for (const bad of ['../private.md', '/tmp/private.md', 'guides/../private.md', '.git/config', '.githooks/pre-push', 'node_modules/key.js', '.env.production', 'PUBLIC_EXPORT.txt', 'PUBLISH_STEPS.md', 'guides\\private.md']) {
    assert.throws(() => validatePublicFiles([...safe, bad]), /Unsafe/, bad);
  }
  assert.throws(() => validatePublicFiles([...safe, safe[0]]), /Duplicate/);
  assert.throws(() => validatePublicFiles([]), /small/);
});
