'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } = require('@vscode/test-electron');

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function findInstalledExtension(extensionsDir, extensionId, expectedVersion) {
  const matches = [];
  for (const entry of await fs.readdir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(extensionsDir, entry.name);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Invalid extension manifest in ${entry.name}`);
      continue;
    }
    if (`${manifest.publisher}.${manifest.name}`.toLowerCase() === extensionId.toLowerCase()) {
      assert.equal(manifest.version, expectedVersion);
      matches.push(root);
    }
  }
  assert.equal(matches.length, 1, `Expected exactly one installed ${extensionId}, found ${matches.length}`);
  return matches[0];
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}

async function main() {
  const repo = path.resolve(__dirname, '../..');
  const metadata = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const extensionId = `${metadata.publisher}.${metadata.name}`;
  const originalEnv = { ...process.env };
  const vsix = originalEnv.VSIX_PATH ? path.resolve(originalEnv.VSIX_PATH)
    : path.join(repo, 'dist', `${metadata.name}-${metadata.version}-marketplace.vsix`);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-model-sync-host-'));
  const home = path.join(temp, 'home');
  const userData = path.join(temp, 'user-data');
  const extensions = path.join(temp, 'extensions');
  const workspace = path.join(temp, 'workspace');
  const tempDir = path.join(temp, 'tmp');
  const vscodeCache = path.join(temp, 'vscode-cache');
  const runnerTemp = originalEnv.RUNNER_TEMP;
  const env = {};
  for (const key of ['PATH', 'DISPLAY', 'XAUTHORITY', 'LANG', 'LC_ALL']) {
    if (originalEnv[key]) env[key] = originalEnv[key];
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    CI: 'true',
    DONT_PROMPT_WSL_INSTALL: '1',
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    XDG_RUNTIME_DIR: path.join(temp, 'runtime'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share')
  });
  let failure;

  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.access(vsix);
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.mkdir(userData, { recursive: true, mode: 0o700 });
    await fs.mkdir(extensions, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(home, '.copilot', 'agents'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(userData, 'User/globalStorage/github.copilot-chat/explore-agent'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(userData, 'User/prompts'), { recursive: true, mode: 0o700 });
    await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
      'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
      'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
      'workbench.enableExperiments': false, 'chat.disableAIFeatures': true
    }));
    await fs.writeFile(path.join(workspace, 'README.md'), '# Synthetic fixture\n');
    const original = "---\nname: Synthetic Agent\ndescription: Synthetic CI fixture\ntarget: vscode\ntools: ['read']\n---\nSynthetic role stays unchanged.\n";
    await fs.writeFile(path.join(home, '.copilot', 'agents', 'fixture.agent.md'), original);
    const source = path.join(userData, 'User/globalStorage/github.copilot-chat/explore-agent/Explore.agent.md');
    const model = 'model: Synthetic CI Model (test-provider)';

    const vscodePath = await downloadAndUnzipVSCode({ version: '1.147.0', cachePath: vscodeCache, reporter: { report() {} } });
    const cli = resolveCliPathFromVSCodeExecutablePath(vscodePath);
    const install = runCommand(cli, ['--user-data-dir', userData, '--extensions-dir', extensions,
      '--install-extension', vsix, '--force'], { cwd: temp, env, timeout: 120000 });
    if (!/successfully installed/i.test(install.stdout + install.stderr)) {
      throw new Error('VS Code CLI did not confirm VSIX installation');
    }

    const installTarget = await findInstalledExtension(extensions, extensionId, metadata.version);
    for (const file of ['extension.cjs', 'sync-core.cjs']) {
      const packed = runCommand('unzip', ['-p', vsix, `extension/${file}`], { encoding: 'buffer', env });
      assert.equal(await sha256(path.join(installTarget, file)), crypto.createHash('sha256').update(packed.stdout).digest('hex'),
        `installed ${file} must match exact VSIX bytes`);
    }
    const installedManifest = JSON.parse(await fs.readFile(path.join(installTarget, 'package.json'), 'utf8'));
    assert.equal(`${installedManifest.publisher}.${installedManifest.name}`.toLowerCase(), extensionId.toLowerCase());
    assert.equal(installedManifest.version, metadata.version);

    const sandbox = path.join(temp, 'sandbox.json');
    await fs.writeFile(sandbox, JSON.stringify({ extensionId, installTarget, expectedVersion: metadata.version }));
    const hostEnv = {
      USER_DATA_DIR: userData,
      SYNTHETIC_HOME: home,
      SYNTHETIC_SOURCE: source,
      SYNTHETIC_MODEL: model,
      SYNTHETIC_AGENT: path.join(home, '.copilot', 'agents', 'fixture.agent.md'),
      SYNTHETIC_ORIGINAL: original,
      SANDBOX_FILE: sandbox
    };
    await runTests({
      vscodeExecutablePath: vscodePath,
      extensionDevelopmentPath: path.join(__dirname, 'harness'),
      extensionTestsPath: path.join(__dirname, 'probe-extension.cjs'),
      extensionTestsEnv: hostEnv,
      launchArgs: [workspace, '--user-data-dir', userData, '--extensions-dir', extensions, '--disable-gpu'],
      reuseMachineInstall: false
    });
    console.log(`PASS: ${extensionId}@${metadata.version} production VSIX host validation`);
  } catch (error) {
    failure = error;
    const summary = {
      outcome: 'failed',
      extensionId,
      version: metadata.version,
      error: String(error && error.stack || error).replaceAll(temp, '<isolated-temp>')
    };
    const output = runnerTemp ? path.join(runnerTemp, 'agent-model-sync-host-diagnostics.json') : null;
    if (output) await fs.writeFile(output, JSON.stringify(summary, null, 2), { mode: 0o600 }).catch(() => {});
    throw error;
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await fs.rm(temp, { recursive: true, force: true }).catch(error => {
      if (!failure) throw error;
    });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
