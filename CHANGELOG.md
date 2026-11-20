# Changelog

## 0.1.1 — 2026-11-20

### Fixed

- Fix Windows synchronization incorrectly blocking with `Refusing symlinked parent` when VS Code supplies a lower-case drive letter but native `realpath` returns an upper-case letter, such as `c:` versus `C:`.
- Apply the same narrowly scoped comparison to the Explore source parent, user agent roots and original-backup directories. Only the drive-letter case may differ; other path differences and actual symbolic links/junctions remain refused.

### Tests

- Add Windows-only temporary-filesystem regressions for lower-case drive paths, both user roots, original preservation, repeated sync and junction rejection, plus a dedicated Windows CI job.
- No model-selection UI, workspace-agent management or built-in-agent configuration is included in this patch.

## 0.1.0 — 2026-11-20

Initial Marketplace release as `BelugaRex.user-agent-model-sync`.

#### Synchronization behavior

- Reads the model of the Copilot Chat Explore agent from its local cache and copies it verbatim to user-level agents, including provider suffix and default fallback list.
- Discovers current and future direct-child agents in `~/.copilot/agents/` (`.md` and `.agent.md`, excluding hidden files and README/LICENSE/CHANGELOG) and `*.agent.md` files in the active profile's `User/prompts/` directory.
- Updates only the top-level `model` field; role text, tools, other frontmatter, body content, newline style, BOM, and file mode are preserved.
- Adds a model-only YAML header when none exists. Existing running invocations are not retargeted, and an explicit caller override may still win.
- Re-discovers after agent file changes and Explore model changes.

#### Safety and recovery

- Refuses symlinked roots, files and backups; dirty editors; concurrent edits; invalid UTF-8; oversized files; unclosed frontmatter; duplicate `model`/`target` keys; unsupported Explore-source model syntax; and incompatible targets. This is a partial frontmatter parser, not a full YAML validator.
- Stores originals once under extension globalStorage (`originals/copilot/` or `originals/profile/`), mode `0600`, without overwriting existing copies. New-identity originals take priority; otherwise matching old local per-root originals are copied read-only, then historical Cavecrew originals, then current files. Unsafe old originals fail the target rather than silently falling back.
- Writes and verifies one file at a time. Failures are reported per file; there is no multi-file transaction or automatic rollback.
- Records `synced`, `partial`, `blocked`, or `disabled` state plus per-file errors in `status.json` and the output channel.
- Disabling the extension stops future edits but does not restore prior models; recovery is manual and restores only the `model` field from the matching original. Preserve a separate backup before uninstalling.
- Refuses activation before registering commands when the old `belugarex-local.user-agent-model-sync` is exposed, even if inactive; requires stopping it and reloading all shared-HOME windows. Does not change the shared enabled setting. This is not a cross-process lock.
- When the separately configured Cavecrew legacy writer is present, updates its global enabled setting to request a stop before synchronizing.

#### Packaging and validation

- Uses the official VSIX packer and an explicit files allowlist, with public source/support URLs.
- Adds verification-only GitHub CI that validates the exact built VSIX in an isolated Linux VS Code `1.147.0` Extension Host.
- The initial live Copilot pair was VS Code `1.147.0` / Copilot Chat `0.75.0` on WSL. Windows path handling required the follow-up fix in `0.1.1`; other desktop platforms were not host-tested.
