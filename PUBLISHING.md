# Publishing Agent Model Sync

This is a **local preparation checklist**, not permission to publish. No Publisher account, repository, Marketplace listing or new extension identity has been created by these steps.

## Local packaging

Use Node.js 22 or later, npm and Python 3. Install the locked development dependencies with `npm ci --ignore-scripts`; the runtime has no third-party dependencies. Installation scripts are not required for the packaging path tested here.

Run `npm test` and `npm run test:package`, then `npm run package:marketplace` and `npm run verify:package`. The package tests cover synthetic rejection cases and a real build from a fresh directory with no `dist/`. Packaging runs only the official `@vscode/vsce` packer and never publishes. It creates `dist/` as needed and writes `dist/user-agent-model-sync-0.1.0-marketplace.vsix`, not the earlier Python-built `dist/user-agent-model-sync-0.1.0.vsix`. Rebuilding overwrites the candidate; archive it separately if needed.

`npm run package:list` lists the allowed source files. The manifest's `files` allowlist contains only the runtime entry/core, public README, changelog and license; the manifest itself is included automatically. Do not add `.vscodeignore` alongside this allowlist. The verifier checks the actual ZIP contents, CRC, identity, engine requirement and source bytes. It rejects unexpected files, including planning notes, development docs, scripts, tests, caches and nested VSIX packages.

This local candidate intentionally permits a missing repository URL when packaging. Do not invent a URL or suppress that omission in release notes. A publisher-owned listing, public support route and icon remain separate work.

## Required release decisions

1. **Publisher and identity:** register or confirm a Marketplace Publisher and check the intended `name` and display name. The candidate retains `belugarex-local.user-agent-model-sync`; this ID has not been confirmed as registered or available. Do not upload under a new ID without deciding migration first.
2. **Existing writer and original backups:** changing `publisher` or `name` changes both extension identity and globalStorage. The current legacy guard covers only `belugarex-local.cavecrew-model-sync`. It will not stop an installed `belugarex-local.user-agent-model-sync` after a rename. Add and test the old-instance stop check and original-backup migration before any such transition. Never run two writers on the same user-agent files.
3. **Compatibility:** the candidate minimum is VS Code 1.147.0, reflecting the previously verified version rather than the old unsupported promise of 1.100.0. The known pair is VS Code 1.147.0 / Copilot Chat 0.75.0 on WSL. The internal Explore cache is not an official inheritance API. Later versions, Windows, macOS and Remote-SSH need separate evidence; browser-only use is unsupported.
4. **Candidate host validation:** test this exact VSIX in a separate VS Code process with dedicated `--user-data-dir` AND `--extensions-dir`, plus a separately verified OS home (`HOME` on Linux/macOS; `USERPROFILE` on Windows). An isolated container or OS account is safer; confirm the actual `os.homedir()` result before loading. A temporary VS Code profile alone does NOT isolate `~/.copilot/agents`, and a separate HOME alone does not isolate profile/global settings. An empty isolated profile has no Explore cache, so `blocked` is the expected first-run state. For the successful path, generate a valid Explore cache through Copilot in that isolated environment or supply a synthetic cache fixture there, without copying personal settings/credentials. Protect real backups and verify activated code/version, source-missing behavior, create/change/delete discovery, original preservation, dirty files, disable and recovery. Do not patch the exact candidate to redirect its hard-coded roots. An older installed package's PASS does not validate this candidate.
5. **Public listing:** review the README, changelog, MIT license and automatic-write/privacy disclosure. Add a PNG icon and a real support/repository link when available. No public Git repository or verified-domain badge is required merely to make the first upload, but a support route is strongly recommended.
6. **Version and channel:** choose the initial release or pre-release explicitly. The filename suffix `-marketplace` is only a local filename, not a pre-release flag; this package remains manifest version 0.1.0. Use the official pre-release packaging option if that channel is chosen. Never reuse a Marketplace version that has already been published.

## Authentication and upload — manual gate

The first release can use the Marketplace management website to upload a locally reviewed VSIX. Publisher registration, authentication, acceptance of service terms and the upload must be explicitly authorized and performed using the publisher owner's account. Never put credentials into repository files, planning notes or chat.

For future GitHub Actions automation, prefer Marketplace Trusted Publishing with OIDC rather than a long-lived PAT. No publishing workflow is installed here. As of the official documentation checked on 2026-11-20, Azure DevOps global PAT retirement is scheduled for 2026-12-01; do not build a new workflow around a global PAT.

`private: true` prevents accidental npm publication; it is NOT a private-Marketplace flag and does not prevent `vsce` from publishing. There is deliberately no `publish` script in this project.

## Official references

- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [vsce](https://github.com/microsoft/vscode-vsce)
