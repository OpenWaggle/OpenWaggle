# Session Summary Reference Capture — 2026-09-04

This capture records the installed Codex desktop behavior used for OpenWaggle's Session Summary parity baseline. It makes the version pin in [ADR 0026](../adr/0026-adopt-session-summary-and-resource-catalog.md) auditable without treating private implementation details as a product contract.

## Installed reference

- Application: `/Applications/ChatGPT.app`, the installed Codex desktop GUI
- Version: `26.831.21537`
- Build: `7579`
- `app.asar` size: 295,874,587 bytes
- `app.asar` SHA-256: `4df5376dd69ec8fd1d99c7e590982d8a10b762116ceb1961c0e2addcc08b07fa`
- Local bundle timestamp: 2026-09-02 08:29 Europe/Madrid

The shipped assets most directly associated with the inspected conversation and Git surfaces were:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `local-conversation-thread-464acd5d92a6.js` | 119 | `f1716169a32033307e9757a1795d504c3732161305a71ae99eec772c84159303` |
| `local-conversation-thread-4c19e6d41315.js` | 335,435 | `60b58ade24a0e5fe765d7376972d5e64b5c3245e6881a9a3edc676c20c5ae9b1` |
| `local-conversation-git-actions-fcb9fd1ad5e7.js` | 51,446 | `5bde135d07b711a40d130ba0287cd208f7c9554ad73ca0e2b423c8003c3027f6` |

Hashes identify the exact shipped reference. They do not assert that minified bundle structure is a public API, and no Codex source is copied into OpenWaggle.

## Observable reference states

The audit exercised the installed UI and recorded these user-visible behaviors:

- The Summary is absent before the first message and appears only when the task has information to summarize.
- It is a top-right floating surface. Opening it does not resize or shift the transcript or composer.
- It yields automatically when the right sidebar is open or the chat surface lacks room. A header control remains available to hide or explicitly reopen it, including as an overlay at narrow widths.
- Environment rows expose changes, local environment or worktree, branch, commit or push, and the current pull-request workflow.
- Creating a pull request opens a composer with source and target refs, editable title and description, optional commit-and-push, draft and normal creation, and an open-in-browser action.
- Summary sections are conditional. Empty domains are omitted rather than shown as disabled placeholders.
- Subagent state is summarized separately from Environment.
- Sources and images collected during the conversation open in a richer side surface. Shared images can be enlarged and navigated as one gallery.

## OpenWaggle mapping and explicit deviations

OpenWaggle matches the interaction model where it owns equivalent state, with these intentional product mappings:

- A Session has one bound project and working tree, so Environment does not invent Codex's multi-root model.
- Hive uses persisted parent and direct-Worker lineage for the Codex Subagents role.
- GitHub uses pull requests; GitLab receives the same native composition flow as merge requests.
- Authorization and model context remain in the composer/setup dock by product decision, never in the Summary.
- OpenWaggle omits generic Activity and Usage sections because it has no truthful account-quota or catch-all activity authority.
- Declarative extension sections are an OpenWaggle addition. The host owns their rendering, placement, session binding, permissions, and failure isolation.

The precise product mapping and data-ownership rules remain canonical in [ADR 0026](../adr/0026-adopt-session-summary-and-resource-catalog.md).

## Reproducible OpenWaggle evidence

The implementation is covered at the interaction boundary rather than by bundle similarity:

- [`e2e/session-summary.e2e.test.ts`](../../e2e/session-summary.e2e.test.ts) covers initial absence, header toggling, responsive suppression, sidebar yielding, Environment/Git actions, Sources/Outputs, resource navigation, and image interactions.
- [`e2e/session-summary-hive.e2e.test.ts`](../../e2e/session-summary-hive.e2e.test.ts) covers opened-Session Hive ownership and direct lineage.
- [`e2e/extension-host.e2e.test.ts`](../../e2e/extension-host.e2e.test.ts) covers hosted extension contributions to the Session Summary.
- [`e2e/visual-regression.e2e.test.ts`](../../e2e/visual-regression.e2e.test.ts) captures wide and narrow overlay geometry, the compact Summary, Resource Browser, image viewer, and change-request composer.

Darwin visual baselines are generated from the repository's Electron app on the CI macOS runner. Hidden real-app QA supplements those deterministic fixtures with representative and edge-case screenshots outside the repository.

## Re-audit rule

An installed Codex update does not silently redefine parity. Changing the reference requires a new behavior audit, a new capture with version and hashes, and an explicit ADR update. New Codex capabilities are adopted only when OpenWaggle has truthful session-owned data and the change is agreed as product scope.
