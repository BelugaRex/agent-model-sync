# Agent Model Sync

Keep user-defined VS Code agents on the same model as the Copilot Chat Explore agent. The extension watches the locally generated Explore configuration and updates only the top-level `model` field of user-level agent files. It makes no network requests, collects no telemetry, has no runtime dependencies, and runs no polling process.

> **Release status:** [Agent Model Sync on the Marketplace](https://marketplace.visualstudio.com/items?itemName=BelugaRex.user-agent-model-sync) was first published as `0.1.0`. This source prepares the `0.1.2` notification patch, including the `0.1.1` Windows fix; a locally built package does not prove that the update is published. [Source code](https://github.com/BelugaRex/agent-model-sync) and [issue reporting](https://github.com/BelugaRex/agent-model-sync/issues) are public. The manifest's `private: true` prevents accidental npm publication, not Marketplace distribution.

## 0.1.2 visible sync results

- Startup and **立即同步 Explore 模型** show a non-modal VS Code notification with the outcome. Successful summaries include the model and target/update counts; partial failures warn, and blocked synchronization reports an error.
- No discovered agents now produces an `empty` status and a warning, not a misleading zero-agent success. **查看详情** opens the output with the notified run's source, exact scanned roots and errors, without running another sync. Zero targets means no user agent was modified; workspace agents are not included.
- Background events notify only when the outcome, model, successful target list or errors change. Repeated checks and the changed count falling to zero do not keep showing notifications. Manual sync always gives feedback. Notifications do not wait for dismissal or ask for write approval.
- Notification visibility still follows VS Code notification/Do Not Disturb settings. After updating, reload relevant windows and check the activated version.

## 0.1.1 Windows fix

Fixes synchronization blocking with `Refusing symlinked parent` solely because Windows returned `C:` for an input path beginning with `c:`. Only drive-letter case is normalized for comparison; real symbolic links/junctions and all other canonical-path differences remain refused. Synchronization behavior and model scope are otherwise unchanged. After installing an update, reload all relevant VS Code windows and check the activated version through the status command.

## What it does

- Reads the model selected for the Copilot Chat Explore agent and copies the value verbatim, including any provider suffix and the full default fallback list.
- Discovers current and future user-level agents automatically. No hand-maintained list is required.
- Changes only the agent's top-level `model` field. Agent role text, tool permissions, other frontmatter fields, body content, newline style, BOM, and file mode stay unchanged.
- Adds a YAML header containing only the model when an agent has no header, leaving the original body intact.
- Re-discovers on agent file create/save/delete and when the Explore model changes.

## Requirements

- GitHub Copilot Chat installed and signed in, with an already generated, valid Explore cache and model.
- VS Code `1.147.0` or later. The manifest minimum is `^1.147.0`; this does not mean every later version has been tested.
- A local, user-level setup. Node `fs` is required, so the extension is not usable in browser-only `vscode.dev`.

The original live Copilot pair was VS Code `1.147.0` with GitHub Copilot Chat `0.75.0` on WSL. Automated verification installs the exact VSIX in an isolated Linux VS Code `1.147.0` Extension Host. The separate Windows filesystem regression tests cover drive-case handling and junction refusal, **not** a full Windows VS Code/Copilot integration test. macOS and Remote-SSH have not been host-tested; browser-only use is unsupported.

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

### Moving from the local extension

Before loading this candidate, retain a separate copy of the old extension's `originals/`, disable or uninstall `belugarex-local.user-agent-model-sync`, and reload **all windows sharing the same HOME**. Leave its globalStorage in place for migration. Both identities share `userAgentModelSync.enabled` and command IDs, so this extension does not toggle that shared setting to stop the old one.

If VS Code exposes the old local extension, even if it has not activated yet, this candidate refuses activation **before registering commands or starting synchronization**. The activation error instructs you to stop the old extension and reload; a fresh status file is not created on this early refusal. If the old extension appears during a later sync, that sync records `blocked` instead. This is a same-host check, not a cross-window or cross-process lock.

For continuity only, this candidate also recognizes the older local writer `belugarex-local.cavecrew-model-sync`. It requests that extension to stop by setting its separate `cavecrewModelSync.enabled` to `false` globally and waits for confirmation before writing. If a workspace setting forces the old writer on, synchronization blocks instead of double-writing. This automatic stop handling is specific to the Cavecrew ID and does not generalize to other extensions.

## Safety, errors, and backups

- Refuses symlinked agent roots, files, and backup destinations; non-regular files; invalid UTF-8; files over 256 KiB; unclosed frontmatter; duplicate `model`/`target` keys; unsupported Explore-source model syntax; and incompatible targets. The parser is deliberately limited, not a general YAML validator.
- Refuses to write to a dirty editor or over a file changed concurrently. Writes are compared before modification and read back afterward.
- On first sync, each original file is stored under the extension globalStorage as `originals/copilot/<filename>` or `originals/profile/<filename>` with mode `0600`. Originals are created once and never overwritten. An existing new-identity backup takes priority. Otherwise, for each discovered agent, the extension copies its matching per-root original from `belugarex-local.user-agent-model-sync` storage if present, then falls back to the two historical Cavecrew filenames' older originals, and finally to the current file. Old backups are only read, never modified or deleted; an unsafe or unreadable old backup blocks that target instead of silently using its current model.
- Files are processed one at a time. There is no multi-file transaction: a failure does not roll back files already written in the same pass. Original backups do not provide crash/power-loss consistency guarantees; retain a separate copy before migration or removal.
- Errors appear per file in the status and the extension output channel, with result notifications as described above. Final status states are `synced`, `empty` (no agents discovered), `partial`, `blocked`, and `disabled` (initial state: `starting`); `status.json` in globalStorage records the activated extension version, discovery counts, successful paths, and per-file errors.

## Storage, privacy, and recovery

The extension's backup/status files stay under VS Code's extension globalStorage: the `originals/` directory and `status.json`. The exact globalStorage path depends on the VS Code profile and installation; the new identity's storage directory is normally `belugarex.user-agent-model-sync` (lowercase). Model edits and local original copies are automatic; no confirmation prompt is shown. If the recognized Cavecrew writer exists, its global `cavecrewModelSync.enabled` setting is also changed to `false` through the VS Code configuration API.

There is no network access, telemetry, runtime dependency, or external service. The extension reads the Explore cache, discovered agent files and matching old originals, writes model fields, new originals and status, and may make the Cavecrew global-settings change described above.

Disabling stops future writes. After uninstalling, reload VS Code to ensure the running instance has stopped. Neither operation automatically restores models. To roll back, use the matching original and restore **only the `model` field**; do not overwrite the whole file, because that would discard later role, tool, or body edits. If an agent originally had no model, remove the field. There is no custom backup-deletion hook; retain a separate copy before uninstalling because VS Code may clean extension storage.

## Development

- `npm test` uses the Node built-in test runner and requires no dependency installation. The main core/mock suite is verified on Linux; Node 20 currently works there.
- On Windows, run `node --test test/windows.test.cjs` for the dedicated temporary-filesystem regressions. These cases are skipped on other platforms; the main Linux suite has POSIX permission and symlink assumptions.
- `npm run package` uses only the Python standard library and writes `dist/user-agent-model-sync-0.1.2.vsix`.
- `npm run package:marketplace` uses the official packaging toolchain, requires `npm ci` and Node 22 or later, and writes a distinct `dist/user-agent-model-sync-0.1.2-marketplace.vsix`.
- `npm run verify:package` checks that Marketplace packaging candidate.

The standard package uses an explicit `files` allowlist; development tooling and planning notes are excluded from the VSIX and are never runtime dependencies. Contributor notes are available in [DEVELOPMENT.md](https://github.com/BelugaRex/agent-model-sync/blob/main/DEVELOPMENT.md) and [PUBLISHING.md](https://github.com/BelugaRex/agent-model-sync/blob/main/PUBLISHING.md); both are excluded from the VSIX. Report problems through [GitHub Issues](https://github.com/BelugaRex/agent-model-sync/issues).

## License

MIT. See `LICENSE`.
