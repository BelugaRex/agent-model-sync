# Agent Model Sync

Keep user-defined VS Code agents on the same model as the Copilot Chat Explore agent. The extension watches the locally generated Explore configuration and updates only the top-level `model` field of user-level agent files. It makes no network requests, collects no telemetry, has no runtime dependencies, and runs no polling process.

> **Status:** `0.1.0` is a local Marketplace packaging candidate, not a published extension. [Source code](https://github.com/BelugaRex/agent-model-sync) and [issue reporting](https://github.com/BelugaRex/agent-model-sync/issues) are public. The manifest remains `private: true` to prevent accidental npm publication; this is not a Marketplace privacy setting. The publisher `belugarex-local` has not been verified as registered, and no Marketplace listing or icon exists yet. A locally built VSIX is not evidence of publication, Marketplace review, or cross-platform support.

## What it does

- Reads the model selected for the Copilot Chat Explore agent and copies the value verbatim, including any provider suffix and the full default fallback list.
- Discovers current and future user-level agents automatically. No hand-maintained list is required.
- Changes only the agent's top-level `model` field. Agent role text, tool permissions, other frontmatter fields, body content, newline style, BOM, and file mode stay unchanged.
- Adds a YAML header containing only the model when an agent has no header, leaving the original body intact.
- Re-discovers on agent file create/save/delete and when the Explore model changes.

## Requirements

- GitHub Copilot Chat installed and signed in, with an already generated, valid Explore cache and model.
- VS Code `1.147.0` or later for this candidate. The manifest minimum is `^1.147.0`; this does not mean every later version has been tested.
- A local, user-level setup. Node `fs` is required, so the extension is not usable in browser-only `vscode.dev`.

The tested pair is VS Code `1.147.0` with GitHub Copilot Chat `0.75.0` on WSL. Windows, macOS, Remote-SSH, and web were **not** tested. A previously installed local copy is also not evidence that this new packaging candidate has been host-tested; load the candidate and verify the actually activated code separately.

## Discovery scope

The extension scans only direct children of these locations:

- `~/.copilot/agents/` — files ending in `.md` or `.agent.md`. Hidden entries and `README.md`, `LICENSE.md`, and `CHANGELOG.md` are ignored (case-insensitive).
- The active VS Code profile's `User/prompts/` directory — files matching `*.agent.md`.

It does not recurse into subdirectories or scan the rest of `HOME`. Workspace `.github/agents`, built-in agents, Claude agents, Unify, and Copilot installation files are out of scope. Agents with an incompatible `target:` value (for example `target: github-copilot`) are reported and skipped rather than being given a Local/VS Code model identifier.

## Behavior and caveats

- Agent invocations that have already started are not retargeted mid-run. A caller that explicitly passes a model may still override the file preference on the next invocation.
- Multiple VS Code windows sharing the same `HOME` also share the same user agent files. The last successful sync wins.
- Files with unsaved editor changes are skipped and reported. Save or close the editor, then sync again.
- Stop activity by setting `userAgentModelSync.enabled` to `false`, or by disabling the extension. Disabling does not automatically restore previous models.

## Commands and settings

Available from the Command Palette:

- **Agent Model Sync: 立即同步 Explore 模型**
- **Agent Model Sync: 查看模型同步状态**

The setting is `userAgentModelSync.enabled` (boolean, default `true`, window scope). Command identifiers remain `userAgentModelSync.sync` and `userAgentModelSync.status`.

## Explore source and compatibility

The read-only source is `github.copilot-chat/explore-agent/Explore.agent.md`, stored beside this extension's globalStorage directory. It must contain a frontmatter with `name: Explore` and a non-empty, supported model value.

This cache layout is an **unofficial internal contract of `github.copilot-chat`**, not a public "inherit the Explore model" API. It may change in any Copilot Chat release. If the source is missing, malformed, or has no valid model, synchronization blocks: the extension does not guess a model and does not delete existing `model` fields.

If another extension with a different publisher or package name writes the same agent files, disable it before enabling this package. Reusing the same extension ID is not a migration solution when moving to a new ID.

For continuity only, this candidate recognizes the older local writer `belugarex-local.cavecrew-model-sync`. It requests that extension to stop by setting `cavecrewModelSync.enabled` to `false` globally and waits for confirmation before writing. If a workspace setting forces the old writer on, synchronization blocks instead of double-writing. This handling is specific to that legacy ID and does not generalize to other extensions.

## Safety, errors, and backups

- Refuses symlinked agent roots, files, and backup destinations; non-regular files; invalid UTF-8; files over 256 KiB; unclosed frontmatter; duplicate `model`/`target` keys; unsupported Explore-source model syntax; and incompatible targets. The parser is deliberately limited, not a general YAML validator.
- Refuses to write to a dirty editor or over a file changed concurrently. Writes are compared before modification and read back afterward.
- On first sync, each original file is stored under the extension globalStorage as `originals/copilot/<filename>` or `originals/profile/<filename>` with mode `0600`. Originals are created once and never overwritten. The two historical Cavecrew filenames can reuse earlier originals migrated from the legacy writer, preserving their pre-sync model state.
- Files are processed one at a time. There is no multi-file transaction: a failure does not roll back files already written in the same pass.
- Errors appear per file in the status and the extension output channel. Final status states are `synced`, `partial`, `blocked`, and `disabled` (initial state: `starting`); `status.json` in globalStorage records the activated extension version, discovery counts, successful paths, and per-file errors.

## Storage, privacy, and recovery

The extension's backup/status files stay under VS Code's extension globalStorage: the `originals/` directory and `status.json`. The exact globalStorage path depends on the VS Code profile and installation. Model edits and local original copies are automatic; no confirmation prompt is shown. If the recognized legacy writer exists, its global `cavecrewModelSync.enabled` setting is also changed to `false` through the VS Code configuration API.

There is no network access, telemetry, runtime dependency, or external service. The extension reads the Explore cache and discovered agent files, writes model fields, originals and status, and may make the legacy global-settings change described above.

Disabling stops future writes. After uninstalling, reload VS Code to ensure the running instance has stopped. Neither operation automatically restores models. To roll back, use the matching original and restore **only the `model` field**; do not overwrite the whole file, because that would discard later role, tool, or body edits. If an agent originally had no model, remove the field. There is no custom backup-deletion hook; retain a separate copy before uninstalling because VS Code may clean extension storage.

## Development

- `npm test` uses the Node built-in test runner and requires no dependency installation. Node 20 currently works.
- `npm run package` uses only the Python standard library and writes `dist/user-agent-model-sync-0.1.0.vsix`.
- `npm run package:marketplace` uses the official packaging toolchain, requires `npm ci` and Node 22 or later, and writes a distinct `dist/user-agent-model-sync-0.1.0-marketplace.vsix`.
- `npm run verify:package` checks that Marketplace packaging candidate.

The standard package uses an explicit `files` allowlist; development tooling and planning notes are excluded from the VSIX and are never runtime dependencies. Contributor notes are available in [DEVELOPMENT.md](https://github.com/BelugaRex/agent-model-sync/blob/main/DEVELOPMENT.md) and [PUBLISHING.md](https://github.com/BelugaRex/agent-model-sync/blob/main/PUBLISHING.md); both are excluded from the VSIX. Report problems through [GitHub Issues](https://github.com/BelugaRex/agent-model-sync/issues). An extension icon remains to be prepared before listing review.

## License

MIT. See `LICENSE`.
