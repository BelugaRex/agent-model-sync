'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { syncFiles, unchangedExceptModel } = require('../sync-core.cjs');
const windowsOnly = { skip: process.platform !== 'win32' };
const agent = (name, model = '') => `---\r\nname: ${name}\r\n${model ? model + '\r\n' : ''}target: vscode\r\ntools: ['read']\r\n---\r\nKeep synthetic role.\r\n`;

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-model-sync-win-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  // Use the native spelling of every component; vary only the drive letter.
  const canonical = await fs.realpath(temporary);
  assert.match(canonical, /^[A-Za-z]:\\/);
  const dir = canonical[0].toLowerCase() + canonical.slice(1);
  const sourcePath = path.join(dir, 'explore', 'Explore.agent.md');
  const roots = [
    { id: 'copilot', dir: path.join(dir, 'agents'), plainMarkdown: true },
    { id: 'profile', dir: path.join(dir, 'prompts'), plainMarkdown: false }
  ];
  await fs.mkdir(path.dirname(sourcePath));
  const originals = new Map();
  for (const root of roots) {
    await fs.mkdir(root.dir);
    const file = path.join(root.dir, 'fixture.agent.md');
    const original = agent('Synthetic', 'model: Before');
    originals.set(file, original);
    await fs.writeFile(file, original);
  }
  await fs.writeFile(sourcePath, agent('Explore', 'model: Synthetic A (test-provider)'));
  return { dir, originals, sourcePath, roots, storageDir: path.join(dir, 'storage') };
}

test('Windows lower-case drive syncs source, both roots and originals without changing role bytes', windowsOnly, async t => {
  const options = await fixture(t);
  const parent = path.dirname(options.sourcePath);
  const realParent = await fs.realpath(parent);
  assert.notEqual(realParent, parent, 'fixture must reproduce the old strict-realpath rejection');
  assert.equal(realParent.slice(1), parent.slice(1));
  assert.equal(realParent[0].toUpperCase(), parent[0].toUpperCase());

  const first = await syncFiles(options);
  assert.deepEqual(first.errors, []);
  assert.equal(first.targets.length, 2);
  assert.equal(first.changed.length, 2);
  for (const root of options.roots) {
    const target = path.join(root.dir, 'fixture.agent.md');
    const updated = await fs.readFile(target, 'utf8');
    assert.ok(unchangedExceptModel(options.originals.get(target), updated));
    assert.ok(updated.includes('model: Synthetic A (test-provider)\r\n'));
    assert.equal(await fs.readFile(path.join(options.storageDir, 'originals', root.id, 'fixture.agent.md'), 'utf8'),
      options.originals.get(target));
  }
  const repeat = await syncFiles(options);
  assert.deepEqual(repeat.errors, []);
  assert.deepEqual(repeat.changed, []);
  await fs.writeFile(options.sourcePath, agent('Explore', 'model: Synthetic B (test-provider)'));
  const next = await syncFiles(options);
  assert.deepEqual(next.errors, []);
  assert.equal(next.changed.length, 2);
  for (const root of options.roots) {
    const target = path.join(root.dir, 'fixture.agent.md');
    assert.ok((await fs.readFile(target, 'utf8')).includes('model: Synthetic B (test-provider)\r\n'));
    assert.equal(await fs.readFile(path.join(options.storageDir, 'originals', root.id, 'fixture.agent.md'), 'utf8'),
      options.originals.get(target));
  }
});

for (const boundary of ['source-parent', 'source-ancestor', 'agent-root', 'backup-directory', 'previous-originals']) {
  test(`Windows directory junction remains refused at ${boundary}`, windowsOnly, async t => {
    const options = await fixture(t);
    options.roots = options.roots.slice(0, 1);
    const target = path.join(options.roots[0].dir, 'fixture.agent.md');
    const alias = path.join(options.dir, 'junction');
    let expectedError;
    let protectedBackup;
    if (boundary.startsWith('source-')) {
      await fs.symlink(boundary === 'source-parent' ? path.dirname(options.sourcePath) : options.dir, alias, 'junction');
      options.sourcePath = path.join(alias, ...(boundary === 'source-parent' ? [] : ['explore']), 'Explore.agent.md');
    } else if (boundary === 'agent-root') {
      await fs.symlink(options.roots[0].dir, alias, 'junction');
      options.roots = [{ ...options.roots[0], dir: alias }];
      expectedError = /symlinked agent root/;
    } else {
      const actual = path.join(options.dir, 'actual-originals');
      await fs.mkdir(actual);
      protectedBackup = path.join(actual, 'fixture.agent.md');
      await fs.writeFile(protectedBackup, 'Synthetic original must stay unchanged.');
      const storage = boundary === 'backup-directory' ? options.storageDir : path.join(options.dir, 'previous');
      await fs.mkdir(path.join(storage, 'originals'), { recursive: true });
      await fs.symlink(actual, path.join(storage, 'originals', 'copilot'), 'junction');
      if (boundary === 'previous-originals') options.previousStorageDir = storage;
      expectedError = boundary === 'backup-directory' ? /symlinked backup directory/ : /symlinked parent/;
    }
    if (boundary.startsWith('source-')) {
      await assert.rejects(syncFiles(options), /symlinked parent/);
    } else {
      const result = await syncFiles(options);
      assert.deepEqual(result.changed, []);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].error, expectedError);
    }
    assert.equal(await fs.readFile(target, 'utf8'), options.originals.get(target));
    if (protectedBackup) assert.equal(await fs.readFile(protectedBackup, 'utf8'), 'Synthetic original must stay unchanged.');
  });
}
