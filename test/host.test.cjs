'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const agent = (name = '', model = '') => `---\n${name ? 'name: ' + name + '\n' : ''}description: test\n${model ? model + '\n' : ''}tools: ['read']\n---\nRole unchanged.\n`;
const uri = filePath => ({ scheme: 'file', fsPath: path.resolve(filePath) });
const disposable = () => ({ dispose() {} });

test('host migrates legacy, follows A→B→fallback, discovers new files and supports generic commands', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'user-agent-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const agentsDir = path.join(home, '.copilot', 'agents');
  const storage = path.join(root, 'User/globalStorage/belugarex-local.user-agent-model-sync');
  const source = path.join(root, 'User/globalStorage/github.copilot-chat/explore-agent/Explore.agent.md');
  const legacyStorage = path.join(root, 'User/globalStorage/belugarex-local.cavecrew-model-sync');
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.mkdir(legacyStorage, { recursive: true });
  await fs.writeFile(path.join(legacyStorage, 'status.json'), JSON.stringify({ state: 'disabled' }));
  await fs.writeFile(path.join(agentsDir, 'anything.agent.md'), agent());
  await fs.writeFile(source, agent('Explore', 'model: A (provider)'));
  const commands = new Map();
  const watchers = [];
  const timers = new Set();
  const listeners = [];
  let enabled = true;
  let legacyEnabled = true;
  const updates = [];
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: id => id === 'belugarex-local.cavecrew-model-sync' ? { isActive: true } : undefined },
    window: { createOutputChannel: title => { assert.equal(title, '用户智能体模型同步'); return { appendLine() {}, show() {}, dispose() {} }; } },
    commands: { registerCommand(name, fn) { commands.set(name, fn); return disposable(); } },
    workspace: {
      textDocuments: [],
      getConfiguration: section => section === 'cavecrewModelSync'
        ? { get: () => legacyEnabled, async update(key, value, scope) { updates.push([key, value, scope]); legacyEnabled = value; } }
        : { get: () => enabled },
      onDidChangeConfiguration(fn) { listeners.push(fn); return disposable(); },
      onDidSaveTextDocument: disposable,
      createFileSystemWatcher(pattern) {
        const callbacks = [];
        const watcher = { pattern, callbacks, dispose() {},
          onDidCreate: fn => (callbacks.push(fn), disposable()),
          onDidChange: fn => (callbacks.push(fn), disposable()),
          onDidDelete: fn => (callbacks.push(fn), disposable()) };
        watchers.push(watcher); return watcher;
      }
    }
  };
  const nativeRequire = createRequire(path.join(__dirname, '..', 'extension.cjs'));
  const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : name === 'node:os' ? { homedir: () => home } : nativeRequire(name),
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); }, Buffer };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '..', 'extension.cjs'), 'utf8'), sandbox);
  const context = { globalStorageUri: uri(storage), subscriptions: [], extension: { packageJSON: { version: 'test' } } };
  const api = await sandbox.module.exports.activate(context);
  assert.equal(api.getStatus().state, 'synced');
  assert.equal(api.getStatus().extensionVersion, 'test');
  assert.equal(api.getStatus().legacyState, 'disabled');
  assert.deepEqual(updates, [['enabled', false, 1]]);
  assert.equal(watchers[1].pattern.pattern, '*.md');
  assert.equal(watchers[2].pattern.pattern, '*.agent.md');
  assert.equal(watchers[2].pattern.base.fsPath, path.join(root, 'User/prompts'));
  const flush = async () => { for (const fn of timers) { timers.delete(fn); await fn(); } };
  for (const model of ['model: B 中文 (provider)', "model: ['Fast', 'Auto']"]) {
    await fs.writeFile(source, agent('Explore', model));
    watchers[0].callbacks[1]();
    await flush();
    assert.equal(api.getStatus().model, model);
  }
  await fs.writeFile(path.join(agentsDir, 'future.md'), agent('Display name different from filename'));
  watchers[1].callbacks[0](); await flush();
  assert.equal(api.getStatus().targets.length, 2);
  await fs.mkdir(path.join(root, 'User/prompts'));
  await fs.writeFile(path.join(root, 'User/prompts/profile.agent.md'), 'Plain body.');
  watchers[2].callbacks[0](); await flush();
  assert.equal(api.getStatus().targets.length, 3);
  await fs.unlink(path.join(agentsDir, 'future.md'));
  watchers[1].callbacks[2](); await flush();
  assert.equal(api.getStatus().targets.length, 2);
  enabled = false;
  listeners[0]({ affectsConfiguration: key => key === 'userAgentModelSync.enabled' }); await flush();
  assert.equal(api.getStatus().state, 'disabled');
  enabled = true;
  await commands.get('userAgentModelSync.sync')();
  assert.equal(api.getStatus().state, 'synced');
  for (const item of context.subscriptions) item.dispose();
  watchers[0].callbacks[1](); assert.equal(timers.size, 0);
});
