'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(predicate, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function readStatus(storage) {
  try { return JSON.parse(await fs.readFile(path.join(storage, 'status.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function run() {
  assert.equal(require('node:os').homedir(), process.env.SYNTHETIC_HOME, 'host HOME must be isolated');
  assert.equal(process.env.GITHUB_TOKEN, undefined, 'host must not inherit GitHub credentials');
  assert.equal(vscode.workspace.isTrusted, true, 'test launcher disables workspace trust');
  assert.equal(vscode.version, '1.147.0');
  const sandbox = JSON.parse(await fs.readFile(process.env.SANDBOX_FILE, 'utf8'));
  const installed = vscode.extensions.getExtension(sandbox.extensionId);
  assert.ok(installed, 'candidate must be installed from the VSIX');
  assert.equal(installed.extensionPath, sandbox.installTarget);
  assert.equal(installed.packageJSON.version, sandbox.expectedVersion);
  const storage = path.join(process.env.USER_DATA_DIR, 'User', 'globalStorage', installed.id.toLowerCase());
  const agentPath = process.env.SYNTHETIC_AGENT;
  const original = process.env.SYNTHETIC_ORIGINAL;
  const source = process.env.SYNTHETIC_SOURCE;
  const model = process.env.SYNTHETIC_MODEL;
  const cache = value => `---\nname: Explore\n${value}\n---\nSynthetic source.\n`;
  const sync = () => vscode.commands.executeCommand('userAgentModelSync.sync');

  const api = await installed.activate();
  assert.ok(installed.isActive);
  assert.equal(api.getStatus().state, 'blocked', 'fresh profile has no Explore cache');
  assert.equal(await fs.readFile(agentPath, 'utf8'), original);
  await assert.rejects(fs.access(path.join(storage, 'originals')), { code: 'ENOENT' });
  assert.equal(api.getStatus().source, source);
  assert.deepEqual(api.getStatus().roots.map(item => item.dir), [
    path.dirname(agentPath), path.join(process.env.USER_DATA_DIR, 'User', 'prompts')
  ]);

  await fs.writeFile(source, cache(model));
  assert.equal((await sync()).state, 'synced');
  const target = await fs.readFile(agentPath, 'utf8');
  assert.equal(target.replace(/^model: .*\n/m, ''), original, 'only model changes');
  assert.ok(target.includes(model + '\n'));
  const backup = path.join(storage, 'originals', 'copilot', 'fixture.agent.md');
  assert.equal(await fs.readFile(backup, 'utf8'), original);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
  const statusCommand = await vscode.commands.executeCommand('userAgentModelSync.status');
  assert.equal(statusCommand.state, 'synced');
  assert.equal(statusCommand.extensionVersion, sandbox.expectedVersion);
  assert.deepEqual(statusCommand.errors, []);

  // Real file watcher smoke: no sync command until each event has been observed.
  const future = path.join(path.dirname(agentPath), 'future.md');
  await fs.writeFile(future, original);
  await waitFor(async () => (await readStatus(storage))?.targets?.includes(future), 'create watcher');
  await fs.writeFile(source, cache('model: Second synthetic model'));
  await waitFor(async () => (await readStatus(storage))?.model === 'model: Second synthetic model', 'source-change watcher');
  assert.ok((await fs.readFile(future, 'utf8')).includes('model: Second synthetic model\n'));
  await fs.unlink(future);
  await waitFor(async () => {
    const status = await readStatus(storage);
    return status?.state === 'synced' && status.targets.length === 1 && !status.targets.includes(future);
  }, 'delete watcher');
  const profileAgent = path.join(process.env.USER_DATA_DIR, 'User', 'prompts', 'profile.agent.md');
  await fs.writeFile(profileAgent, original);
  assert.equal((await sync()).targets.length, 2);
  assert.ok((await fs.readFile(profileAgent, 'utf8')).includes('model: Second synthetic model\n'));

  const setting = vscode.workspace.getConfiguration('userAgentModelSync');
  await setting.update('enabled', false, vscode.ConfigurationTarget.Global);
  await waitFor(async () => (await readStatus(storage))?.state === 'disabled', 'disable setting event');
  const beforeDisabled = await fs.readFile(agentPath, 'utf8');
  await fs.writeFile(source, cache('model: Resumed synthetic model'));
  assert.equal((await sync()).state, 'disabled');
  assert.equal(await fs.readFile(agentPath, 'utf8'), beforeDisabled);
  await setting.update('enabled', true, vscode.ConfigurationTarget.Global);
  await waitFor(async () => (await readStatus(storage))?.model === 'model: Resumed synthetic model', 're-enable setting event');
  assert.equal(await fs.readFile(backup, 'utf8'), original);

  const beforeBlocked = await fs.readFile(agentPath, 'utf8');
  await fs.unlink(agentPath);
  await fs.unlink(profileAgent);
  const empty = await sync();
  assert.equal(empty.state, 'empty');
  assert.equal(empty.discovered, 0);
  assert.deepEqual(empty.targets, []);
  assert.deepEqual(empty.errors, []);
  assert.equal((await readStatus(storage)).state, 'empty');
  await fs.writeFile(agentPath, beforeBlocked);
  assert.equal((await sync()).state, 'synced');
  await fs.writeFile(source, '---\nname: Wrong Source\nmodel: Must not write\n---\n');
  assert.equal((await sync()).state, 'blocked');
  assert.equal(await fs.readFile(agentPath, 'utf8'), beforeBlocked);
  await fs.unlink(source);
  assert.equal((await sync()).state, 'blocked');
  assert.equal(await fs.readFile(agentPath, 'utf8'), beforeBlocked);
  console.log('PASS: production VSIX; isolated HOME/storage; missing/invalid source; model-only backups; commands; watchers; disable/recovery; zero-target empty status');
}

module.exports = { run };
