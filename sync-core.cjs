'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const MAX_BYTES = 256 * 1024;

function header(text, required = false) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Agent exceeds 256 KiB');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ text: match[0].replace(/\r?\n$/, ''), start: match.index }));
  if (lines[0]?.text.replace(/^\uFEFF/, '') !== '---') {
    if (required) throw new Error('Missing YAML header');
    return { present: false, bom, newline, models: [] };
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.text === '---');
  if (closing < 1) throw new Error('Unclosed YAML header');
  const fields = lines.slice(1, closing);
  const modelLines = fields.filter(line => /^(?:model|['"]model['"])\s*:/.test(line.text));
  if (modelLines.length > 1) throw new Error('Duplicate model field');
  let model;
  if (modelLines.length) {
    const first = lines.indexOf(modelLines[0]);
    let end = first + 1;
    const value = lines[first].text.replace(/^[^:]+:/, '').trim();
    if (!value || /^[|>]/.test(value) || (value.startsWith('[') && !value.endsWith(']'))) {
      while (end < closing && /^(?:\s+\S|-\s)/.test(lines[end].text)) end++;
    }
    model = { start: lines[first].start, end: lines[end].start,
      raw: text.slice(lines[first].start, lines[end].start).replace(/\r?\n$/, '') };
  }
  return { present: true, bom, newline, fields, model, insertAt: lines[closing].start,
    bodyAt: lines[closing + 1]?.start ?? text.length };
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return value; } }
  return value;
}

function extractModel(text) {
  const parsed = header(text, true);
  const names = parsed.fields.filter(line => /^name:/.test(line.text));
  if (names.length !== 1 || unquote(names[0].text.slice(5).trim()) !== 'Explore') throw new Error('Expected Explore source');
  if (!parsed.model) throw new Error('Explore has no model field');
  const raw = parsed.model.raw.replace(/\r\n/g, '\n');
  const value = raw.replace(/^model\s*:/, '').trim();
  const scalar = item => {
    if (item.startsWith("'")) return /^'(?:[^']|'')+'$/.test(item);
    if (item.startsWith('"')) {
      try { return typeof JSON.parse(item) === 'string' && JSON.parse(item).length > 0; } catch { return false; }
    }
    return !!item && !/^(?:null|true|false|~)$/i.test(item) && !/^[!&*|>{}\[\]@`#]/.test(item)
      && !/:\s|\s#|\n|\r/.test(item);
  };
  let valid;
  if (value.startsWith('[')) {
    valid = /^\[\s*'(?:[^']|'')+'(?:\s*,\s*'(?:[^']|'')+')*\s*\]$/.test(value);
  } else if (raw.includes('\n')) {
    const lines = raw.split('\n');
    valid = lines[0].trim() === 'model:' && lines.length > 1
      && lines.slice(1).every(line => /^\s*-\s+/.test(line) && scalar(line.replace(/^\s*-\s+/, '')));
  } else valid = scalar(value);
  if (!valid || value.includes('${')) throw new Error('Explore model is empty or unsupported');
  return raw;
}

function ensureCompatible(text) {
  const parsed = header(text);
  const targets = (parsed.fields || []).filter(line => /^target:/.test(line.text));
  if (targets.length > 1) throw new Error('Duplicate target field');
  if (targets.length && unquote(targets[0].text.slice(7).trim()) !== 'vscode') {
    throw new Error('Incompatible target: only Local/VS Code model identifiers can follow Explore');
  }
  return parsed;
}

function updateModel(text, model) {
  const parsed = ensureCompatible(text);
  const replacement = model.replace(/\r\n/g, '\n').replace(/\n/g, parsed.newline) + parsed.newline;
  if (!parsed.present) return parsed.bom + '---' + parsed.newline + replacement + '---' + parsed.newline + text.slice(parsed.bom.length);
  return parsed.model
    ? text.slice(0, parsed.model.start) + replacement + text.slice(parsed.model.end)
    : text.slice(0, parsed.insertAt) + replacement + text.slice(parsed.insertAt);
}

function withoutModel(text) {
  const parsed = header(text);
  if (!parsed.model) return text;
  return text.slice(0, parsed.model.start) + text.slice(parsed.model.end);
}

function unchangedExceptModel(before, after) {
  if (header(before).present) return withoutModel(before) === withoutModel(after);
  const parsed = header(after, true);
  return after === updateModel(before, parsed.model.raw);
}

async function regularPath(filePath) {
  const resolved = path.resolve(filePath);
  if (await fs.realpath(path.dirname(resolved)) !== path.dirname(resolved)) throw new Error('Refusing symlinked parent');
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing non-regular file');
  if (stat.size > MAX_BYTES) throw new Error('Agent exceeds 256 KiB');
  return stat;
}

async function readRegular(filePath) {
  await regularPath(filePath);
  const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return decoder.decode(await handle.readFile()); } finally { await handle.close(); }
}

async function discoverAgents(roots) {
  const found = [];
  const errors = [];
  for (const root of roots) {
    try {
      if (await fs.realpath(root.dir) !== path.resolve(root.dir)) throw new Error('Refusing symlinked agent root');
      for (const entry of (await fs.readdir(root.dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || /^(?:README|LICENSE|CHANGELOG)\.md$/i.test(entry.name)) continue;
        if (!(root.plainMarkdown ? /\.md$/i : /\.agent\.md$/i).test(entry.name)) continue;
        const item = { root: root.id, filename: entry.name, filePath: path.join(root.dir, entry.name) };
        if (entry.isSymbolicLink()) errors.push({ file: item.filePath, error: 'Refusing symlinked agent' });
        else if (entry.isFile()) found.push(item);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push({ file: root.dir, error: error.message });
    }
  }
  return { found, errors };
}

async function saveOriginal(storageDir, entry, text, previousStorageDir, legacyStorageDir) {
  const originals = path.join(storageDir, 'originals', entry.root);
  await fs.mkdir(originals, { recursive: true, mode: 0o700 });
  if (await fs.realpath(originals) !== path.resolve(originals)) throw new Error('Refusing symlinked backup directory');
  const backup = path.join(originals, entry.filename);
  try { await readRegular(backup); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let original = text;
  const previous = previousStorageDir && path.join(previousStorageDir, 'originals', entry.root, entry.filename);
  const legacy = legacyStorageDir && entry.root === 'copilot'
    && ['cavecrew.agent.md', 'cavecrew-builder.agent.md'].includes(entry.filename)
    && path.join(legacyStorageDir, 'originals', entry.filename);
  for (const candidate of [previous, legacy].filter(Boolean)) {
    try { original = await readRegular(candidate); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { await fs.writeFile(backup, original, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await readRegular(backup); }
}

async function syncFiles({ sourcePath, roots, storageDir, previousStorageDir, legacyStorageDir, canWrite = () => true }) {
  const source = await readRegular(sourcePath);
  const model = extractModel(source);
  const { found, errors } = await discoverAgents(roots);
  const entries = [];
  for (const entry of found) {
    try {
      if (!canWrite(entry.filePath)) throw new Error('Save or close the dirty editor before syncing');
      const before = await readRegular(entry.filePath);
      entries.push({ ...entry, before, after: updateModel(before, model) });
    } catch (error) { errors.push({ file: entry.filePath, error: error.message }); }
  }
  if (await readRegular(sourcePath) !== source) throw new Error('Explore changed during sync; retry on next event');
  const changed = [];
  const targets = [];
  for (const entry of entries) {
    try {
      await saveOriginal(storageDir, entry, entry.before, previousStorageDir, legacyStorageDir);
      if (entry.before !== entry.after) {
        if (!canWrite(entry.filePath)) throw new Error('Dirty editor');
        await regularPath(entry.filePath);
        const handle = await fs.open(entry.filePath, constants.O_RDWR | constants.O_NOFOLLOW);
        try {
          if (decoder.decode(await handle.readFile()) !== entry.before) throw new Error('Concurrent edit; not overwriting');
          const bytes = Buffer.from(entry.after);
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
            if (!bytesWritten) throw new Error('Short write');
            offset += bytesWritten;
          }
          await handle.truncate(bytes.length);
          await handle.sync();
        } finally { await handle.close(); }
        changed.push(entry.filePath);
      }
      if (await readRegular(entry.filePath) !== entry.after) throw new Error('Post-write verification failed');
      targets.push(entry.filePath);
    } catch (error) { errors.push({ file: entry.filePath, error: error.message }); }
  }
  return { model, changed, targets, errors, discovered: found.length };
}

module.exports = { extractModel, updateModel, withoutModel, unchangedExceptModel, readRegular, discoverAgents, syncFiles };
