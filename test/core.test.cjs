'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractModel, updateModel, unchangedExceptModel, readRegular, syncFiles } = require('../sync-core.cjs');
const agent = (name = '', model = '') => `---\n${name ? 'name: ' + name + '\n' : ''}description: fixed\n${model ? model + '\n' : ''}target: vscode\ntools: ['read']\n---\n\nKeep role 中文.\n`;

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-agent-sync-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const roots = [{ id: 'copilot', dir: path.join(dir, 'agents'), plainMarkdown: true },
    { id: 'profile', dir: path.join(dir, 'prompts'), plainMarkdown: false }];
  await fs.mkdir(roots[0].dir);
  const sourcePath = path.join(dir, 'Explore.agent.md');
  await fs.writeFile(sourcePath, agent('Explore', 'model: A 中文 (provider)'));
  return { sourcePath, roots, storageDir: path.join(dir, 'storage') };
}

test('model scalar/provider/list/block preservation; no filename/name coupling', () => {
  for (const model of ['model: A 中文 (provider)', "model: ['Fast (provider)', 'Auto (copilot)']", 'model:\n  - Fast (provider)\n  - Auto (copilot)']) {
    assert.equal(extractModel(agent('Explore', model)), model);
    for (const original of [agent(), agent('Other display name'), agent('Agent', 'model: Old'), '\uFEFFPlain body\r\n']) {
      const updated = updateModel(original, model);
      assert.ok(unchangedExceptModel(original, updated));
      assert.equal(updateModel(updated, model), updated);
    }
  }
});

test('BOM CRLF comments blanks role and multiline model replacement preserve unrelated bytes', () => {
  const original = '\uFEFF' + agent('Name', "model: Old\n\n# retained").replace(/\n/g, '\r\n');
  const updated = updateModel(original, 'model: New');
  assert.ok(unchangedExceptModel(original, updated));
  assert.ok(updated.includes('\r\n\r\n# retained\r\n'));
  assert.ok(updated.startsWith('\uFEFF'));
  const multiline = agent('', 'model:\n- Old\n- Older');
  assert.ok(unchangedExceptModel(multiline, updateModel(multiline, 'model: New')));
});

test('invalid source/header/tag/empty/partial list is refused', () => {
  for (const model of ['', 'model: []', 'model: null', 'model: ${config:x}', 'model: !tag X',
    "model: ['Unclosed'", 'model: {x: y}', 'model: Bad: Mapping', 'model: X\nmodel: Y']) {
    assert.throws(() => extractModel(agent('Explore', model)));
  }
  assert.throws(() => extractModel(agent('Wrong', 'model: X')));
  assert.throws(() => updateModel('---\nname: X', 'model: X'));
});

test('discovers all current and future names, plain markdown and profile agents, not README or workspace', async t => {
  const options = await fixture(t);
  const copilot = options.roots[0].dir;
  const profile = options.roots[1].dir;
  await fs.mkdir(profile);
  const originals = new Map([
    [path.join(copilot, 'first.agent.md'), agent()],
    [path.join(copilot, 'another-name.md'), agent('Different UI name')],
    [path.join(profile, 'profile.agent.md'), 'Plain role body\n']
  ]);
  for (const [file, content] of originals) await fs.writeFile(file, content);
  for (const file of [path.join(copilot, 'README.md'), path.join(profile, 'unrelated.md')]) await fs.writeFile(file, 'do not touch');
  const first = await syncFiles(options);
  assert.equal(first.targets.length, 3);
  assert.deepEqual(first.errors, []);
  for (const [file, before] of originals) assert.ok(unchangedExceptModel(before, await fs.readFile(file, 'utf8')));
  const added = path.join(copilot, 'future.agent.md');
  await fs.writeFile(added, agent());
  const next = await syncFiles(options);
  assert.equal(next.targets.length, 4);
  assert.deepEqual(next.changed, [added]);
  await fs.unlink(added);
  assert.equal((await syncFiles(options)).targets.length, 3);
  assert.equal(await fs.readFile(path.join(copilot, 'README.md'), 'utf8'), 'do not touch');
  assert.equal(await fs.readFile(path.join(profile, 'unrelated.md'), 'utf8'), 'do not touch');
});

test('no agents and absent roots are a successful empty discovery', async t => {
  const options = await fixture(t);
  const result = await syncFiles(options);
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.errors, []);
});

test('existing model overridden; modes backups and idempotence; legacy original migrated', async t => {
  const options = await fixture(t);
  const target = path.join(options.roots[0].dir, 'cavecrew.agent.md');
  await fs.writeFile(target, agent('cavecrew', 'model: Previous'));
  await fs.chmod(target, 0o640);
  const legacyStorageDir = path.join(path.dirname(options.sourcePath), 'legacy');
  await fs.mkdir(path.join(legacyStorageDir, 'originals'), { recursive: true });
  await fs.writeFile(path.join(legacyStorageDir, 'originals', 'cavecrew.agent.md'), agent('cavecrew'));
  const opts = { ...options, legacyStorageDir };
  assert.equal((await syncFiles(opts)).changed.length, 1);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
  const backup = path.join(options.storageDir, 'originals/copilot/cavecrew.agent.md');
  assert.equal(await fs.readFile(backup, 'utf8'), agent('cavecrew'));
  const mtime = (await fs.stat(target)).mtimeMs;
  assert.deepEqual((await syncFiles(opts)).changed, []);
  assert.equal((await fs.stat(target)).mtimeMs, mtime);
  await fs.writeFile(options.sourcePath, agent('Explore', "model: ['Fallback', 'Auto']"));
  await syncFiles(opts);
  assert.equal(await fs.readFile(backup, 'utf8'), agent('cavecrew'));
});

test('bad, dirty, symlink and incompatible target reported individually; healthy agents still sync', async t => {
  const options = await fixture(t);
  const dir = options.roots[0].dir;
  await fs.writeFile(path.join(dir, 'healthy.agent.md'), agent());
  await fs.writeFile(path.join(dir, 'bad.agent.md'), '---\nbroken');
  await fs.writeFile(path.join(dir, 'dirty.agent.md'), agent());
  await fs.writeFile(path.join(dir, 'other.agent.md'), agent().replace('target: vscode', 'target: github-copilot'));
  await fs.symlink(path.join(dir, 'healthy.agent.md'), path.join(dir, 'alias.agent.md'));
  const result = await syncFiles({ ...options, canWrite: file => !file.endsWith('dirty.agent.md') });
  assert.equal(result.targets.length, 1);
  assert.equal(result.errors.length, 4);
  assert.equal(await fs.readFile(path.join(dir, 'dirty.agent.md'), 'utf8'), agent());
  assert.equal(await fs.readFile(path.join(dir, 'other.agent.md'), 'utf8'), agent().replace('target: vscode', 'target: github-copilot'));
});

test('source symlink invalid UTF-8 and root symlink do not escape boundaries', async t => {
  const options = await fixture(t);
  const alias = options.sourcePath + '-alias';
  await fs.symlink(options.sourcePath, alias);
  await assert.rejects(syncFiles({ ...options, sourcePath: alias }), /non-regular/);
  const rootAlias = options.roots[0].dir + '-alias';
  await fs.symlink(options.roots[0].dir, rootAlias);
  const result = await syncFiles({ ...options, roots: [{ id: 'copilot', dir: rootAlias, plainMarkdown: true }] });
  assert.equal(result.errors.length, 1);
  await fs.writeFile(options.sourcePath, Buffer.from([0xff]));
  await assert.rejects(syncFiles(options), /encoded data/);
});

test('backup symlink refuses writing target', async t => {
  const options = await fixture(t);
  const target = path.join(options.roots[0].dir, 'test.agent.md');
  await fs.writeFile(target, agent());
  const dir = path.join(options.storageDir, 'originals', 'copilot');
  await fs.mkdir(dir, { recursive: true });
  await fs.symlink(target, path.join(dir, 'test.agent.md'));
  const result = await syncFiles(options);
  assert.equal(result.errors.length, 1);
  assert.equal(await fs.readFile(target, 'utf8'), agent());
});

test('publisher migration preserves per-root originals, modern priority and existing new backups', async t => {
  const options = await fixture(t);
  const previousStorageDir = path.join(path.dirname(options.sourcePath), 'previous');
  const legacyStorageDir = path.join(path.dirname(options.sourcePath), 'legacy');
  await fs.mkdir(path.join(legacyStorageDir, 'originals'), { recursive: true });
  await fs.writeFile(path.join(legacyStorageDir, 'originals/cavecrew.agent.md'), 'Older legacy original');
  const entries = [
    ['copilot', 'cavecrew.agent.md', agent('Original copilot')],
    ['profile', 'cavecrew.agent.md', 'Original profile body\n'],
    ['copilot', 'arbitrary.md', agent('Arbitrary original', 'model: Before sync')]
  ];
  for (const [rootId, filename, original] of entries) {
    const root = options.roots.find(item => item.id === rootId);
    await fs.mkdir(root.dir, { recursive: true });
    await fs.mkdir(path.join(previousStorageDir, 'originals', rootId), { recursive: true });
    await fs.writeFile(path.join(root.dir, filename), agent('Already synchronized', 'model: Current'));
    await fs.writeFile(path.join(previousStorageDir, 'originals', rootId, filename), original);
  }
  const opts = { ...options, previousStorageDir, legacyStorageDir };
  const result = await syncFiles(opts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.targets.length, entries.length);
  for (const [rootId, filename, original] of entries) {
    const backup = path.join(options.storageDir, 'originals', rootId, filename);
    assert.equal(await fs.readFile(backup, 'utf8'), original);
    assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(path.join(previousStorageDir, 'originals', rootId, filename), 'utf8'), original);
    await fs.writeFile(path.join(previousStorageDir, 'originals', rootId, filename), Buffer.from([0xff]));
  }
  assert.deepEqual((await syncFiles(opts)).errors, []);
  for (const [rootId, filename, original] of entries) {
    assert.equal(await fs.readFile(path.join(options.storageDir, 'originals', rootId, filename), 'utf8'), original);
  }
});

test('missing previous originals fall back to legacy; unsafe previous originals block target writes', async t => {
  const options = await fixture(t);
  const previousStorageDir = path.join(path.dirname(options.sourcePath), 'previous');
  const legacyStorageDir = path.join(path.dirname(options.sourcePath), 'legacy');
  const dir = options.roots[0].dir;
  await fs.mkdir(path.join(legacyStorageDir, 'originals'), { recursive: true });
  await fs.writeFile(path.join(legacyStorageDir, 'originals/cavecrew.agent.md'), agent('Legacy original'));
  await fs.writeFile(path.join(dir, 'cavecrew.agent.md'), agent('Current cavecrew'));
  await fs.writeFile(path.join(dir, 'new-agent.md'), agent('New unsynced agent'));
  const opts = { ...options, previousStorageDir, legacyStorageDir };
  assert.deepEqual((await syncFiles(opts)).errors, []);
  assert.equal(await fs.readFile(path.join(options.storageDir, 'originals/copilot/cavecrew.agent.md'), 'utf8'), agent('Legacy original'));
  assert.equal(await fs.readFile(path.join(options.storageDir, 'originals/copilot/new-agent.md'), 'utf8'), agent('New unsynced agent'));
  const previous = path.join(previousStorageDir, 'originals/copilot');
  await fs.mkdir(previous, { recursive: true });
  const original = agent('Do not overwrite', 'model: Current');
  for (const filename of ['invalid.md', 'alias.md', 'cavecrew-builder.agent.md']) await fs.writeFile(path.join(dir, filename), original);
  await fs.writeFile(path.join(previous, 'invalid.md'), Buffer.from([0xff]));
  await fs.writeFile(path.join(previous, 'cavecrew-builder.agent.md'), Buffer.from([0xff]));
  await fs.writeFile(path.join(legacyStorageDir, 'originals/cavecrew-builder.agent.md'), agent('Must not fallback'));
  await fs.symlink(path.join(dir, 'alias.md'), path.join(previous, 'alias.md'));
  const result = await syncFiles(opts);
  assert.equal(result.errors.length, 3);
  for (const filename of ['invalid.md', 'alias.md', 'cavecrew-builder.agent.md']) {
    assert.equal(await fs.readFile(path.join(dir, filename), 'utf8'), original);
    await assert.rejects(fs.stat(path.join(options.storageDir, 'originals/copilot', filename)), { code: 'ENOENT' });
  }
});

test('symlinked previous backup directory blocks migration without changing targets', async t => {
  const options = await fixture(t);
  const previousStorageDir = path.join(path.dirname(options.sourcePath), 'previous');
  const actual = path.join(path.dirname(options.sourcePath), 'actual-originals');
  await fs.mkdir(actual);
  await fs.mkdir(path.join(previousStorageDir, 'originals'), { recursive: true });
  await fs.symlink(actual, path.join(previousStorageDir, 'originals/copilot'));
  await fs.writeFile(path.join(actual, 'test.md'), agent('Old original'));
  const target = path.join(options.roots[0].dir, 'test.md');
  await fs.writeFile(target, agent('Current'));
  const result = await syncFiles({ ...options, previousStorageDir });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /symlinked parent/);
  assert.equal(await fs.readFile(target, 'utf8'), agent('Current'));
  assert.equal(await fs.readFile(path.join(actual, 'test.md'), 'utf8'), agent('Old original'));
});

test('unsafe legacy fallback, new backup directory and invalid existing backup refuse writes', async t => {
  for (const boundary of ['legacy', 'new-directory', 'existing-backup']) {
    const options = await fixture(t);
    const target = path.join(options.roots[0].dir, 'cavecrew.agent.md');
    const original = agent('Current', 'model: Old');
    await fs.writeFile(target, original);
    const legacyStorageDir = path.join(path.dirname(options.sourcePath), 'legacy');
    if (boundary === 'legacy') {
      await fs.mkdir(path.join(legacyStorageDir, 'originals'), { recursive: true });
      await fs.symlink(target, path.join(legacyStorageDir, 'originals/cavecrew.agent.md'));
    } else if (boundary === 'new-directory') {
      await fs.mkdir(path.join(options.storageDir, 'originals'), { recursive: true });
      await fs.symlink(options.roots[0].dir, path.join(options.storageDir, 'originals/copilot'));
    } else {
      await fs.mkdir(path.join(options.storageDir, 'originals/copilot'), { recursive: true });
      await fs.writeFile(path.join(options.storageDir, 'originals/copilot/cavecrew.agent.md'), Buffer.from([0xff]));
    }
    const result = await syncFiles({ ...options, legacyStorageDir });
    assert.equal(result.errors.length, 1, boundary);
    assert.equal(await fs.readFile(target, 'utf8'), original, boundary);
    assert.deepEqual(result.changed, [], boundary);
  }
});
