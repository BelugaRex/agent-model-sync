'use strict';

const vscode = require('vscode');
const path = require('node:path');

function activate(context) {
  const sandbox = JSON.parse(require('node:fs').readFileSync(process.env.SANDBOX_FILE, 'utf8'));
  const extension = vscode.extensions.getExtension(sandbox.extensionId);
  if (!extension) throw new Error(`Installed candidate ${sandbox.extensionId} not found`);
  const installedRoot = path.resolve(sandbox.installTarget);
  if (path.resolve(extension.extensionPath) !== installedRoot) throw new Error('Candidate extension path escaped the VSIX install directory');
  context.subscriptions.push({ dispose() {} });
}

module.exports = { activate };
