'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { syncFiles } = require('./sync-core.cjs');

async function pauseLegacy(storageDir) {
  const legacy = vscode.extensions.getExtension('belugarex-local.cavecrew-model-sync');
  if (!legacy) return 'not-installed';
  const config = vscode.workspace.getConfiguration('cavecrewModelSync');
  if (config.get('enabled', true)) await config.update('enabled', false, vscode.ConfigurationTarget.Global);
  if (config.get('enabled', true)) throw new Error('旧同步器存在工作区覆盖设置，请先禁用旧扩展');
  if (!legacy.isActive) return 'disabled';
  const statusPath = path.join(storageDir, 'status.json');
  const isDisabled = async () => {
    try { return JSON.parse(await fs.readFile(statusPath, 'utf8')).state === 'disabled'; }
    catch { return false; }
  };
  if (await isDisabled()) return 'disabled';
  await new Promise((resolve, reject) => {
    let timer;
    let watcher;
    let checking = false;
    let done = false;
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      watcher?.close();
      if (error) reject(error); else resolve();
    };
    const check = async () => {
      if (checking || done) return;
      checking = true;
      if (await isDisabled()) finish();
      checking = false;
    };
    try {
      watcher = watch(storageDir, check);
      watcher.on('error', finish);
      timer = setTimeout(() => finish(new Error('旧同步器尚未确认停用；为避免双写，暂不启动新同步')), 5000);
      check();
    } catch (error) { finish(error); }
  });
  return 'disabled';
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Agent Model Sync');
  const sourceUri = vscode.Uri.joinPath(context.globalStorageUri, '..', 'github.copilot-chat', 'explore-agent', 'Explore.agent.md');
  const legacyStorage = vscode.Uri.joinPath(context.globalStorageUri, '..', 'belugarex-local.cavecrew-model-sync').fsPath;
  const roots = [
    { id: 'copilot', dir: path.join(os.homedir(), '.copilot', 'agents'), plainMarkdown: true },
    { id: 'profile', dir: vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'prompts').fsPath, plainMarkdown: false }
  ];
  const storageDir = context.globalStorageUri.fsPath;
  const extensionVersion = context.extension.packageJSON.version;
  let timer;
  let disposed = false;
  let queue = Promise.resolve();
  let status = { state: 'starting', extensionVersion, source: sourceUri.fsPath, roots };
  const isClean = filePath => !vscode.workspace.textDocuments.some(document =>
    document.uri.scheme === 'file' && path.resolve(document.uri.fsPath) === filePath && document.isDirty);

  async function run() {
    if (disposed) return;
    try {
      if (!vscode.workspace.getConfiguration('userAgentModelSync').get('enabled', true)) {
        status = { ...status, state: 'disabled', checkedAt: new Date().toISOString() };
      } else {
        const legacyState = await pauseLegacy(legacyStorage);
        const result = await syncFiles({ sourcePath: sourceUri.fsPath, roots, storageDir,
          legacyStorageDir: legacyStorage, canWrite: isClean });
        status = { state: result.errors.length ? 'partial' : 'synced', extensionVersion,
          source: sourceUri.fsPath, roots, legacyState, ...result, checkedAt: new Date().toISOString() };
        output.appendLine(`${status.checkedAt} 已同步 ${result.targets.length} 个用户智能体，更新 ${result.changed.length} 个：${result.model}`);
        for (const item of result.errors) output.appendLine(`未同步 ${item.file}: ${item.error}`);
      }
    } catch (error) {
      status = { ...status, state: 'blocked', error: error.message, checkedAt: new Date().toISOString() };
      output.appendLine(`${status.checkedAt} 同步阻塞：${error.message}`);
    }
    await fs.mkdir(storageDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(storageDir, 'status.json'), JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
    return status;
  }
  function enqueue() {
    queue = queue.then(run).catch(error => output.appendLine(`状态保存失败：${error.message}`));
    return queue;
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(enqueue, 200);
  }
  context.subscriptions.push(output,
    { dispose() { disposed = true; clearTimeout(timer); } },
    vscode.commands.registerCommand('userAgentModelSync.sync', enqueue),
    vscode.commands.registerCommand('userAgentModelSync.status', async () => {
      await enqueue(); output.appendLine(JSON.stringify(status, null, 2)); output.show(true); return status;
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (['chat.exploreAgent.defaultModel', 'github.copilot.chat.exploreAgent.model',
        'userAgentModelSync.enabled', 'cavecrewModelSync.enabled'].some(key => event.affectsConfiguration(key))) schedule();
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.fsPath === sourceUri.fsPath || roots.some(root => path.dirname(document.uri.fsPath) === root.dir)) schedule();
    })
  );
  for (const [base, pattern] of [
    [vscode.Uri.joinPath(sourceUri, '..'), 'Explore.agent.md'],
    ...roots.map(root => [vscode.Uri.file(root.dir), root.plainMarkdown ? '*.md' : '*.agent.md'])
  ]) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
    context.subscriptions.push(watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule));
  }
  await enqueue();
  return { sync: enqueue, getStatus: () => status };
}

module.exports = { activate, pauseLegacy };
