'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { syncFiles } = require('./sync-core.cjs');

function assertPreviousWriterStopped() {
  if (vscode.extensions.getExtension('belugarex-local.user-agent-model-sync')) {
    throw new Error('请先禁用或卸载旧扩展 belugarex-local.user-agent-model-sync，并重载所有共用 HOME 的窗口；新旧扩展共享命令和设置，不能同时启用');
  }
}

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
  assertPreviousWriterStopped();
  const output = vscode.window.createOutputChannel('Agent Model Sync');
  const sourceUri = vscode.Uri.joinPath(context.globalStorageUri, '..', 'github.copilot-chat', 'explore-agent', 'Explore.agent.md');
  const previousStorage = vscode.Uri.joinPath(context.globalStorageUri, '..', 'belugarex-local.user-agent-model-sync').fsPath;
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
  let lastNotification;
  const isClean = filePath => !vscode.workspace.textDocuments.some(document =>
    document.uri.scheme === 'file' && path.resolve(document.uri.fsPath) === filePath && document.isDirty);

  function notifyResult(result, force) {
    if (disposed) return;
    const key = JSON.stringify([result.state, result.model, result.targets, result.errors, result.error]);
    if (!force && key === lastNotification) return;
    lastNotification = key;
    const prefix = `Agent Model Sync ${extensionVersion}：`;
    const model = result.model?.replace(/^model:\s*/, '').replace(/\s+/g, ' ');
    let method = 'showInformationMessage';
    let message;
    if (result.state === 'blocked') {
      method = 'showErrorMessage';
      message = `同步阻塞：${result.error}`;
    } else if (result.state === 'partial') {
      method = 'showWarningMessage';
      message = `同步未完全完成：成功 ${result.targets.length} 个，更新 ${result.changed.length} 个，${result.errors.length} 项错误。模型：${model}。查看详情了解未同步原因。`;
    } else if (result.state === 'empty') {
      method = 'showWarningMessage';
      message = `未发现用户智能体，本次未修改任何文件。模型：${model}。仅扫描当前宿主的 ~/.copilot/agents 和活动配置档 User/prompts，不包含工作区智能体。`;
    } else if (result.state === 'disabled') {
      message = '自动同步已暂停，未执行同步。';
    } else {
      message = `已同步 ${result.targets.length} 个用户智能体，更新 ${result.changed.length} 个。模型：${model}`;
    }
    // Do not await dismissal: a pending notification must not block activation or the sync queue.
    try {
      Promise.resolve(vscode.window[method](prefix + message, '查看详情')).then(action => {
        if (disposed || action !== '查看详情') return;
        output.appendLine(JSON.stringify(result, null, 2));
        output.show(true);
      }).catch(error => output.appendLine(`通知显示失败：${error.message}`));
    } catch (error) { output.appendLine(`通知显示失败：${error.message}`); }
  }

  async function run(notify) {
    if (disposed) return;
    try {
      if (!vscode.workspace.getConfiguration('userAgentModelSync').get('enabled', true)) {
        status = { state: 'disabled', extensionVersion, source: sourceUri.fsPath, roots, checkedAt: new Date().toISOString() };
      } else {
        assertPreviousWriterStopped();
        const legacyState = await pauseLegacy(legacyStorage);
        const result = await syncFiles({ sourcePath: sourceUri.fsPath, roots, storageDir,
          previousStorageDir: previousStorage, legacyStorageDir: legacyStorage, canWrite: isClean });
        status = { state: result.errors.length ? 'partial' : result.discovered ? 'synced' : 'empty', extensionVersion,
          source: sourceUri.fsPath, roots, legacyState, ...result, checkedAt: new Date().toISOString() };
        output.appendLine(status.state === 'empty'
          ? `${status.checkedAt} 未发现用户智能体，未修改任何文件：${result.model}`
          : `${status.checkedAt} ${status.state === 'partial' ? '同步未完全完成，成功' : '已同步'} ${result.targets.length} 个用户智能体，更新 ${result.changed.length} 个：${result.model}`);
        for (const item of result.errors) output.appendLine(`未同步 ${item.file}: ${item.error}`);
      }
    } catch (error) {
      status = { state: 'blocked', extensionVersion, source: sourceUri.fsPath, roots,
        error: error.message, checkedAt: new Date().toISOString() };
      output.appendLine(`${status.checkedAt} 同步阻塞：${error.message}`);
    }
    await fs.mkdir(storageDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(storageDir, 'status.json'), JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
    notifyResult(status, notify);
    return status;
  }
  function enqueue(notify = false) {
    queue = queue.then(() => run(notify)).catch(error => {
      output.appendLine(`状态保存失败：${error.message}`);
      status = { state: 'blocked', extensionVersion, source: sourceUri.fsPath, roots,
        error: `状态保存失败（本轮可能已修改部分智能体）：${error.message}`, checkedAt: new Date().toISOString() };
      notifyResult(status, notify);
      return status;
    });
    return queue;
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(enqueue, 200);
  }
  context.subscriptions.push(output,
    { dispose() { disposed = true; clearTimeout(timer); } },
    vscode.commands.registerCommand('userAgentModelSync.sync', () => enqueue(true)),
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
  await enqueue(true);
  return { sync: () => enqueue(true), getStatus: () => status };
}

module.exports = { activate, pauseLegacy };
