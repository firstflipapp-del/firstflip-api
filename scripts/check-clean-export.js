#!/usr/bin/env node
'use strict';

// Exercise the complete content check on exactly the tree a downloader gets.
// The nested check has no export step, so this proof never recursively copies itself.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readPublicFiles } = require('./public-files');

const root = path.resolve(__dirname, '..');
const files = readPublicFiles(root);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'firstflip-public-check-'));
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { cwd: scratch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed\n${result.stdout || ''}${result.stderr || ''}`);
  return result;
};

try {
  const realRoot = fs.realpathSync(root);
  for (const file of files) {
    const source = path.join(root, file);
    const realSource = fs.realpathSync(source);
    if (!realSource.startsWith(realRoot + path.sep) || !fs.statSync(source).isFile()) throw new Error('Public export entry is not an owned file');
    const target = path.join(scratch, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const privateName of ['PUBLIC_EXPORT.txt', 'PUBLISH_STEPS.md', 'CLAUDE.md', 'ATTRIBUTION.md', '.env']) {
    if (fs.existsSync(path.join(scratch, privateName))) throw new Error('Private file entered the public export');
  }
  // CI has installed this lockfile already. Reuse that exact installation for
  // the temporary tree; dependencies never become part of the published files.
  const dependencies = fs.realpathSync(path.join(root, 'node_modules'));
  fs.symlinkSync(dependencies, path.join(scratch, 'node_modules'), 'dir');
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['add', '.']);
  const child = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check:content'], { env: { ...process.env, PUBLIC_EXPORT: '' } });
  process.stdout.write(child.stdout);
  console.log(`Clean public export passed: ${files.length} files, no private publishing files, full content check.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
