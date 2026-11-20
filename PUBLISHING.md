# Publishing Agent Model Sync

Version `0.1.0` is published at [Agent Model Sync](https://marketplace.visualstudio.com/items?itemName=BelugaRex.user-agent-model-sync). This checklist prepares the `0.1.1` Windows bugfix update under the same `BelugaRex.user-agent-model-sync` identity. A local build or GitHub commit is not proof that this update has been uploaded or published. The public source repository is <https://github.com/BelugaRex/agent-model-sync>, with support through [GitHub Issues](https://github.com/BelugaRex/agent-model-sync/issues).

## Local packaging

Use Node.js 22 or later, npm and Python 3. Install the locked development dependencies with `npm ci --ignore-scripts`; the runtime has no third-party dependencies. Installation scripts are not required for the packaging path tested here.

On Linux, run `npm test` and `npm run test:package`, then `npm run package:marketplace` and `npm run verify:package`. Also run `node --test test/windows.test.cjs` on real Windows; skipped Linux cases are not Windows validation. The package tests cover synthetic rejection cases and a real build from a fresh directory with no `dist/`. Packaging runs only the official `@vscode/vsce` packer and never publishes. It creates `dist/` as needed and writes `dist/user-agent-model-sync-0.1.1-marketplace.vsix`, leaving the retained `0.1.0` artifacts untouched. Rebuilding overwrites only the same-version candidate; archive it separately if needed.

`npm run package:list` lists the allowed source files. The manifest's `files` allowlist contains only the runtime entry/core, public README, changelog and license; the manifest itself is included automatically. Do not add `.vscodeignore` alongside this allowlist. The verifier checks the actual ZIP contents, CRC, identity, engine requirement and source bytes. It rejects unexpected files, including planning notes, development docs, scripts, tests, caches and nested VSIX packages.

The manifest includes the real public `repository`, `bugs` and `homepage` URLs and `publisher: BelugaRex`. Packaging does not bypass a missing repository. Authenticated update permissions and listing review remain separate work; an icon is optional and is not part of this bugfix.

## Automated host validation

GitHub Actions (`.github/workflows/ci.yml`) builds and verifies the Marketplace candidate, records its SHA-256, and runs that same artifact twice in a real Linux VS Code 1.147.0 Extension Host on Ubuntu 24.04 under Xvfb. The product is installed from the VSIX in a temporary extensions directory; only a separate harness is loaded as a development extension. Installed runtime hashes are compared with the VSIX, and the host checks identity, version and actual extension path. HOME, XDG directories, user data, workspace and download cache are isolated, using only synthetic agents/cache and an allowlisted environment. Temporary data is cleaned up; failures upload only an error summary for three days.

Host coverage: initially missing and malformed Explore cache blocking, model-only updates, original backup preservation/permissions, both agent roots, sync/status commands, actual create/change/delete watcher events, disable and recovery. The old-ID activation guard and migration precedence remain covered separately by mocked host/core tests. A dedicated Windows job runs the real temporary-filesystem drive-case and junction regressions twice; it is not a Windows Extension Host test. Workspace trust is disabled by the test launcher, so untrusted-workspace refusal is not covered. No real Copilot login/cache generation, Windows/macOS/Remote-WSL integration, multi-window arbitration, Marketplace permissions, or publication is tested. The workflow has read-only permissions and no publish job. For local Linux reproduction, build the candidate first, then run `npm run test:host` under a display server or `xvfb-run -a`; VS Code is downloaded on every invocation. VS Code is not uploaded as an artifact.

## Required release decisions

1. **Publisher and identity:** retain Publisher `BelugaRex` and extension ID `BelugaRex.user-agent-model-sync`. Name and display name remain unchanged; the patch version is `0.1.1`. Before uploading, sign in through <https://marketplace.visualstudio.com/manage> and confirm that this Publisher is present in the owner's account and permits the upload. No account credentials or service terms have been handled by this project.
2. **Existing writer and original backups:** changing publisher changes extension identity and globalStorage. The new candidate refuses activation before command registration when VS Code exposes `belugarex-local.user-agent-model-sync`, regardless of its activation state. Back up its originals separately, disable/uninstall it and reload all windows sharing HOME before loading this candidate; do not use the shared `userAgentModelSync.enabled` setting to stop only the old writer. Keep its storage for read-only migration: existing new originals win, otherwise matching old `originals/copilot/` or `originals/profile/` files are copied, then historical Cavecrew originals are considered, then current files. Unsafe or unreadable old originals fail that target. Old backups are not modified or deleted. The separate `belugarex-local.cavecrew-model-sync` setting-based stop check remains. These migration paths have isolated regression coverage; they are not a global process lock or exact-candidate live-host evidence.
3. **Compatibility:** the candidate minimum is VS Code 1.147.0, reflecting the previously verified version rather than the old unsupported promise of 1.100.0. The known pair is VS Code 1.147.0 / Copilot Chat 0.75.0 on WSL. The internal Explore cache is not an official inheritance API. Later versions, Windows, macOS and Remote-SSH need separate evidence; browser-only use is unsupported.
4. **Candidate host validation:** the verification-only GitHub Actions workflow runs the candidate VSIX in a separate Linux Extension Host with synthetic data; it is not a Marketplace upload or a real Copilot login/cache test. For any manual real-user validation, use separate `--user-data-dir` AND `--extensions-dir`, plus a separately verified OS home (`HOME` on Linux/macOS; `USERPROFILE` on Windows). An isolated container or OS account is safer; confirm the actual `os.homedir()` result before loading. A temporary VS Code profile alone does NOT isolate `~/.copilot/agents`, and a separate HOME alone does not isolate profile/global settings. Protect real backups and verify activated code/version, source-missing behavior, create/change/delete discovery, original preservation, dirty files, disable and recovery. Do not patch the exact candidate to redirect its hard-coded roots. An older installed package's PASS does not validate this candidate.
5. **Public listing:** review the README, changelog, MIT license and automatic-write/privacy disclosure. Public repository and support links are in place; no icon or branding change is included in this patch.
6. **Version and channel:** publish `0.1.1` as an update to the existing release, not as a new extension. The filename suffix `-marketplace` is only a local filename, not a pre-release flag. Never reuse the published `0.1.0` version. In the Publisher management page, open the existing extension's update action and upload the reviewed `0.1.1` VSIX; wait for verification and check its public version history.

## Existing-instance activation gate

The old shared-setting writer check runs before runtime command handlers, watchers or status writes are registered. VS Code may still display both extensions' statically contributed command titles. If the old ID is exposed, activation fails with an explanatory error; no fresh status is written, and a previous status file must not be mistaken for a new successful run. Stop the old writer and reload before retrying. `blocked` describes failures handled after successful activation (for example, missing Explore cache in a clean isolated host).

## Authentication and upload — manual gate

The first release can use the Marketplace management website to upload a locally reviewed VSIX. Publisher registration, authentication, acceptance of service terms and the upload must be explicitly authorized and performed using the publisher owner's account. Never put credentials into repository files, planning notes or chat.

For future GitHub Actions automation, prefer Marketplace Trusted Publishing with OIDC rather than a long-lived PAT. No publishing workflow is installed here. As of the official documentation checked on 2026-11-20, Azure DevOps global PAT retirement is scheduled for 2026-12-01; do not build a new workflow around a global PAT.

`private: true` prevents accidental npm publication; it is NOT a private-Marketplace flag and does not prevent `vsce` from publishing. There is deliberately no `publish` script in this project.

## Official references

- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [vsce](https://github.com/microsoft/vscode-vsce)
