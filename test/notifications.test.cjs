'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const uri = filePath => ({ scheme: 'file', fsPath: path.resolve(filePath) });
const disposable = () => ({ dispose() {} });
const agent = '---\ndescription: fixture\ntools: [read]\n---\nKeep role.\n';
const cache = model => `---\nname: Explore\nmodel: ${model}\n---\nSynthetic source.\n`;

async function fixture(t, withAgent = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-notifications-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const agents = path.join(home, '.copilot/agents');
  const source = path.join(root, 'User/globalStorage/github.copilot-chat/explore-agent/Explore.agent.md');
  const storage = path.join(root, 'User/globalStorage/belugarex.user-agent-model-sync');
  await fs.mkdir(agents, { recursive: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, cache('A (provider)'));
  if (withAgent) await fs.writeFile(path.join(agents, 'fixture.agent.md'), agent);
  const commands = new Map();
  const timers = new Set();
  const watchers = [];
  const messages = [];
  const logs = [];
  const shows = [];
  let enabled = true;
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    extensions: { getExtension: () => undefined },
    window: {
      createOutputChannel: () => ({ appendLine: line => logs.push(line), show: focus => shows.push(focus), dispose() {} })
    },
    commands: { registerCommand(name, fn) { commands.set(name, fn); return disposable(); } },
    workspace: {
      textDocuments: [],
      getConfiguration: () => ({ get: () => enabled }),
      onDidChangeConfiguration: disposable,
      onDidSaveTextDocument: disposable,
      createFileSystemWatcher() {
        const callbacks = [];
        const watcher = { callbacks, dispose() {},
          onDidCreate: fn => (callbacks.push(fn), disposable()),
          onDidChange: fn => (callbacks.push(fn), disposable()),
          onDidDelete: fn => (callbacks.push(fn), disposable()) };
        watchers.push(watcher);
        return watcher;
      }
    }
  };
  for (const [method, level] of [['showInformationMessage', 'info'], ['showWarningMessage', 'warning'], ['showErrorMessage', 'error']]) {
    vscode.window[method] = (text, ...actions) => new Promise(resolve => messages.push({ level, text, actions, resolve }));
  }
  const nativeRequire = createRequire(path.join(__dirname, '..', 'extension.cjs'));
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'vscode' ? vscode : name === 'node:os' ? { homedir: () => home } : nativeRequire(name),
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); }, Buffer
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '..', 'extension.cjs'), 'utf8'), sandbox);
  const context = { globalStorageUri: uri(storage), subscriptions: [], extension: { packageJSON: { version: 'test' } } };
  const api = await sandbox.module.exports.activate(context);
  const dispose = () => { for (const item of context.subscriptions) item.dispose(); };
  t.after(dispose);
  const background = async () => {
    watchers[0].callbacks[1]();
    for (const fn of timers) { timers.delete(fn); await fn(); }
  };
  return { api, source, agents, storage, commands, messages, logs, shows, background, dispose,
    setEnabled: value => { enabled = value; }, window: vscode.window };
}

test('empty startup warns without blocking; manual repeats; details opens captured roots without syncing', async t => {
  const f = await fixture(t);
  assert.equal(f.api.getStatus().state, 'empty');
  assert.equal(f.messages.length, 1, 'activation returned while toast promise is unresolved');
  assert.equal(f.messages[0].level, 'warning');
  assert.match(f.messages[0].text, /未发现用户智能体.*未修改任何文件/);
  assert.match(f.messages[0].text, /不包含工作区智能体/);
  assert.deepEqual(f.messages[0].actions, ['查看详情']);
  assert.match(f.logs[0], /未发现用户智能体/);
  await f.background(); await f.background();
  assert.equal(f.messages.length, 1, 'repeated empty watcher results are silent');
  await f.commands.get('userAgentModelSync.sync')('unexpected-command-argument');
  assert.equal(f.messages.length, 2, 'manual sync always gives feedback');
  f.messages[1].resolve(undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.shows, [], 'dismissing a toast does not open details');
  await fs.writeFile(f.source, cache('B (provider)'));
  const statusBefore = await fs.readFile(path.join(f.storage, 'status.json'), 'utf8');
  f.messages[0].resolve('查看详情');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.shows, [true]);
  assert.match(f.logs.at(-1), /"roots"/);
  assert.match(f.logs.at(-1), /model: A \(provider\)/, 'details describe the notified run');
  assert.equal(await fs.readFile(path.join(f.storage, 'status.json'), 'utf8'), statusBefore);
  await f.commands.get('userAgentModelSync.status')();
  assert.equal(f.api.getStatus().model, 'model: B (provider)');
  const count = f.messages.length;
  await f.commands.get('userAgentModelSync.status')();
  assert.equal(f.messages.length, count, 'unchanged status reads do not force another toast');
  await fs.access(f.agents);
  assert.deepEqual(await fs.readdir(f.agents), []);
});

test('background summaries deduplicate writes, errors and disabled state, then report recovery', async t => {
  const f = await fixture(t, true);
  assert.equal(f.messages[0].level, 'info');
  assert.match(f.messages[0].text, /已同步 1.*更新 1.*A \(provider\)/);
  await f.background(); await f.background();
  assert.equal(f.messages.length, 1, 'changed count falling to zero does not notify again');
  await fs.writeFile(f.source, cache('B 中文 (provider)'));
  await f.background();
  assert.equal(f.messages.length, 2);
  assert.match(f.messages.at(-1).text, /B 中文/);
  await fs.writeFile(path.join(f.agents, 'incompatible.agent.md'), '---\ntarget: github-copilot\n---\nKeep.');
  await f.background();
  assert.equal(f.api.getStatus().state, 'partial');
  assert.equal(f.messages.at(-1).level, 'warning');
  assert.match(f.messages.at(-1).text, /成功 1.*1 项错误/);
  const partialCount = f.messages.length;
  await f.background();
  assert.equal(f.messages.length, partialCount);
  await fs.unlink(f.source);
  await f.background();
  assert.equal(f.messages.at(-1).level, 'error');
  assert.equal(f.api.getStatus().model, undefined, 'blocked state does not retain stale success');
  const blockedCount = f.messages.length;
  await f.background();
  assert.equal(f.messages.length, blockedCount);
  f.setEnabled(false);
  await f.background();
  assert.match(f.messages.at(-1).text, /自动同步已暂停/);
  const disabledCount = f.messages.length;
  await f.background();
  assert.equal(f.messages.length, disabledCount);
  f.setEnabled(true);
  await fs.unlink(path.join(f.agents, 'incompatible.agent.md'));
  await fs.writeFile(f.source, cache('C (provider)'));
  await f.background();
  assert.equal(f.api.getStatus().state, 'synced');
  assert.equal(f.messages.at(-1).level, 'info');
  assert.match(f.messages.at(-1).text, /C \(provider\)/);
  await fs.unlink(path.join(f.agents, 'fixture.agent.md'));
  await f.background();
  assert.equal(f.api.getStatus().state, 'empty');
  assert.equal(f.messages.at(-1).level, 'warning');
  await fs.writeFile(path.join(f.agents, 'incompatible.agent.md'), '---\ntarget: github-copilot\n---\nKeep.');
  await f.background();
  assert.equal(f.api.getStatus().state, 'partial', 'rejected targets must not look like empty discovery');
  assert.match(f.messages.at(-1).text, /成功 0.*1 项错误/);
  const count = f.messages.length;
  f.dispose();
  await f.api.sync();
  f.messages.at(-1).resolve('查看详情');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.length, count);
  assert.deepEqual(f.shows, [], 'disposed notifications cannot reopen the output');
});

test('notification failures do not change sync outcome; status-save failures get actionable error feedback', async t => {
  const f = await fixture(t, true);
  f.window.showInformationMessage = () => { throw new Error('notification API failed'); };
  assert.equal((await f.api.sync()).state, 'synced');
  assert.match(f.logs.at(-1), /通知显示失败/);
  f.window.showInformationMessage = () => Promise.reject(new Error('notification rejected'));
  assert.equal((await f.api.sync()).state, 'synced');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.logs.at(-1), /notification rejected/);
  await fs.rm(f.storage, { recursive: true, force: true });
  await fs.writeFile(f.storage, 'not a directory');
  assert.equal((await f.api.sync()).state, 'blocked');
  assert.equal(f.messages.at(-1).level, 'error');
  assert.match(f.messages.at(-1).text, /状态保存失败.*可能已修改部分智能体/);
});
