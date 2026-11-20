'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { extractModel, discoverAgents, unchangedExceptModel, readRegular } = require('./sync-core.cjs');
const metadata = require('./package.json');
const userDir = path.join(os.homedir(), '.vscode-server/data/User');
const extensionId = `${metadata.publisher}.${metadata.name}`.toLowerCase();
const storage = path.join(userDir, 'globalStorage', extensionId);
const source = path.join(userDir, 'globalStorage/github.copilot-chat/explore-agent/Explore.agent.md');
const installed = path.join(os.homedir(), '.vscode-server/extensions', `${extensionId}-${metadata.version}`);

async function verify() {
  const status = JSON.parse(await readRegular(path.join(storage, 'status.json')));
  assert.equal(status.state, 'synced');
  assert.equal(status.extensionVersion, metadata.version);
  assert.ok(['disabled', 'not-installed'].includes(status.legacyState));
  assert.equal(status.source, source);
  const model = extractModel(await readRegular(source));
  assert.equal(status.model, model);
  const { found, errors } = await discoverAgents(status.roots);
  assert.deepEqual(errors, []);
  assert.deepEqual([...status.targets].sort(), found.map(entry => entry.filePath).sort());
  for (const entry of found) {
    const current = await readRegular(entry.filePath);
    const original = await readRegular(path.join(storage, 'originals', entry.root, entry.filename));
    assert.ok(unchangedExceptModel(original, current), `${entry.filename}: original role/tool bytes changed`);
    assert.equal(current, require('./sync-core.cjs').updateModel(current, model));
  }
  const installedMetadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  delete installedMetadata.__metadata;
  assert.deepEqual(installedMetadata, metadata);
  for (const name of ['extension.cjs', 'sync-core.cjs', 'README.md', 'LICENSE']) {
    assert.deepEqual(await fs.readFile(path.join(installed, name)), await fs.readFile(path.join(__dirname, name)), `Installed ${name} differs`);
  }
  const expectFile = process.argv.find(arg => arg.startsWith('--expect='))?.slice('--expect='.length);
  if (expectFile) assert.ok(status.targets.includes(path.resolve(expectFile)), 'New user agent has not been discovered yet');
  console.log(`PASS: active ${metadata.version}, ${found.length} dynamically discovered user agents, model/role/tool/backup parity, legacy paused, installed source intact.`);
}

async function main() {
  if (!process.argv.includes('--wait')) return verify();
  return new Promise((resolve, reject) => {
    let running = false;
    let done = false;
    let lastError;
    const watcher = watch(storage, () => attempt());
    const timer = setTimeout(() => finish(lastError || new Error('Timed out waiting for actual host sync')), 10000);
    function finish(error) {
      if (done) return;
      done = true; clearTimeout(timer); watcher.close();
      if (error) reject(error); else resolve();
    }
    async function attempt() {
      if (running || done) return;
      running = true;
      try { await verify(); finish(); } catch (error) { lastError = error; }
      finally { running = false; }
    }
    watcher.on('error', finish);
    attempt();
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
