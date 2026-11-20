# Changelog

## Unreleased

### Local `0.1.0` packaging candidate

This candidate has not been published to any Marketplace. The owner confirmed Publisher ID `BelugaRex`, applied as `BelugaRex.user-agent-model-sync`; authenticated ownership/permissions and the final upload remain separate gates.

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

#### Packaging preparation

- Adds a standard packaged candidate alongside the existing local VSIX artifact, using an explicit files allowlist.
- Adds public-facing documentation, this changelog and real public source/support URLs; no Marketplace release is implied.
- Tested against VS Code `1.147.0` with GitHub Copilot Chat `0.75.0` on WSL only; other platforms were not tested.
