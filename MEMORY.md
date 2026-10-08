# MEMORY.md

Durable OpenWaggle project memory. Keep this compact and technical. Do not add personal/cross-repo agent preferences here.

## Active Warnings

- The working tree may contain another agent's active refactor. Treat dirty files as intended future shape unless there is clear evidence otherwise.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed. Add durable OpenWaggle memory here or to focused skills.
- MCP activation wording needs an app-side follow-up: `McpProjectControl.tsx` calls Global MCP a master switch, but `src/main/domain/mcp/scope-policy.ts` resolves explicit session > project > global overrides. User docs describe the implemented precedence; global off alone is not a universal stop for explicit overrides.
- The historical Docker token benchmark is not a validated rerun workflow. `inside.sh` uses `os.environ` without importing `os` in its DSH probe; `proxy.py` forwards streamed chunks and then writes the collected response again, and binds its credential-injecting listener to `0.0.0.0`. Fix and test those paths before recommending credentialed reruns. The seven comparison rows have archived proxy usage; OpenWaggle's row came from a separate bundled-SDK probe, not a configured GUI session. Earlier reproduction and equal-routing claims below are superseded by this audit.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not manually scaffold it during unrelated work.

## Current Architecture Direction

### CI is tiered behind a merge queue (ADR 0029, September 2026 — superseded by ADR 0033; see "Merge queue removed" below. Retained for history.)

A 2026-09-01 audit of ~300 CI runs (~36h) found 51% green / 21% failed / 27% cancelled, with 85% of failures concentrated on three agent PRs. The enforced merge gate was only three ubuntu checks; the 3-OS E2E matrix and package rehearsals ran informationally per push, so agents burned multi-hour loops on reds that never gated merges. Windows E2E failed 33% of runs — two-thirds of failures were "all 29 tests pass, then `Worker teardown timeout of 90000ms`" (a hanging shutdown, not a test problem), the rest Windows-timing test timeouts and locator misses. `hive-sessions.e2e.test.ts` on PR #181 failed 8× consecutively on a JSON parse race: `applicationCliStdout` returns raw stdout when its extraction grammar does not match, so a leading `{}` empty payload plus trailing content explodes in `JSON.parse`.

Fixes shipped: Fast gate per push (static checks split into Unit / Integration & Component / MCP Conformance jobs + macOS E2E with `retries: 2` and `PLAYWRIGHT_WORKERS: '2'`), Full gate on `merge_group` results (adds Windows/Linux E2E plus path-scoped rehearsals: package consumer smoke when `packages/**`/lockfile/release tooling changed; website/docs rehearsal when website/docs **or package** surfaces changed). `scripts/package-release-gate.ts` encodes tier semantics (`full|fast|fast-no-e2e|visual`); required-but-skipped is an error, skipped-conditional is fine. `e2e/support/electron-process-tree.ts` bounds `app.close()` at 10s, names surviving descendants into `$GITHUB_STEP_SUMMARY`, and force-kills the tree (`taskkill /T /F` on Windows) — a safety net whose forensics feed the root-cause hunt for non-clean Windows exits. The settings-side half (enable merge queue + update the required-check list to the new job names) is a maintainer runbook step in `docs/release-and-versioning.md`. It must be applied in the same admin window as the merge: the rename retires the `Unit & Component Tests` context, so between merge and ruleset swap open PRs show a forever-pending required check until an admin applies the swap or merges with the routine bypass.

Adding a reusable CI job requires a deliberate update to the stable job-name list,
caller AST contract, and exact local-workflow reference allowlist. Validate the callee's
AST through the production file validator too, including its immutable SHA preflight,
checkout, permissions, and required commands. Do not exempt reusable jobs generically
or accept their success without the selected gate dependency and result check.
### Merge queue removed (ADR 0033, September 2026, refines ADR 0029)

Releasing a feature felt slow mainly because the merge queue re-ran the Full gate (Windows + Linux Electron E2E + path-scoped rehearsals) on the speculative merge result (~15–25 min), on top of the PR run and the `push: main` run — and Windows E2E is the flakiest gate (~33% teardown-timeout rate). Decision: drop the `merge_queue` rule from the `main` ruleset so PRs merge directly once the required per-PR checks pass; leave all workflow code and release guards unchanged. A full t3code-style rewrite (lean 3-job CI + tag/nightly release) was scoped and rejected as-is: it is incompatible with OpenWaggle's deliberately security-hardened, test-pinned release machinery — `ci.yml`'s fail-closed supply-chain contract (`package-release-validator-*.ts` inside `pnpm check`) requires the classify/prepare/candidate/gate jobs + SLSA provenance attestation that `package-release.yml` consumes, and `release.yml`'s human-approved app-release flow is enforced by `app-release-workflow.unit.test.ts` (never pushes to main, never auto-merges, publishes only a verified human-merged commit). Gutting either to fit a leaner shape removes real security for velocity; right-sizing the package-release apparatus (heavy for a v0.1 alpha with no external consumers) is a legitimate separate change deferred to its own decision. Consequence of removal: main can briefly go red from a semantic conflict between two green PRs. Follow-ups in the same PR: the Release Please version-bump PR (no source changes) now skips the app suite (unit/integration/component/MCP) via an identity-scoped job condition (`!(pull_request && head_ref == 'release-please--branches--main' && head.repo.full_name == github.repository)`, so a fork PR cannot name its way into a skip), accepted by a new fail-closed gate tier `release-pr` that still requires commit policy + `check` + the package candidate (so `prepare-package-release` still attests tarballs). Adding that skip required registering the three test jobs in `QUEUE_ONLY_JOB_CONDITIONS`, decoupling the blocking-job-contract `+if` allowance from the special-runner check in `release-ci-policy.ts`, setting the exact-release-branch `==` guard count to 6, and regenerating `CI_WORKFLOW_AST_CONTRACT` — the normal process for an intentional ci.yml change. Provenance attestation and human-approved releases stay intact. Also in the same PR: the entire Electron E2E suite (`e2e/`, `playwright.config.ts`, the three `electron-e2e-*` jobs) is removed — evidence from `pingdotgg/t3code` is that a shipping multi-platform Electron product runs CI on vitest unit+integration only and has no E2E (its `playwright-core` is an in-app browser-preview feature, not tests). OpenWaggle's 3-OS E2E was the dominant flake (Windows ~33% teardown-timeout). Per-PR gating is now commit-policy + static + unit + integration/component + MCP; the fail-closed gate/policy/AST-hash/tests were updated to drop the E2E jobs (kept the Playwright deps: `playwright-core` powers browser preview, `@playwright/test` powers package browser smoke + website screenshots + QA). A coverage audit (`docs/agents/e2e-removal-coverage-map.md`) found the E2E suite was almost entirely belt-and-suspenders over existing unit/integration/component coverage, so no functional behavior leaves the gate; the nightly cross-OS packaged canary (`.github/workflows/nightly.yml`) covers packaged build + native runtime load + the macOS syntax budget, while renderer boot/CSP/visual/timing have no automated CI control (local/manual only). `e2e/support/session-fixtures.ts` (used by QA seeding + website screenshots) was relocated to `scripts/support/` with an eslint override, since lint never covered `e2e/`.

### The commit policy was invisible to agents

Manual CI has no pull-request base SHA. Resolve its exact candidate's merge base
with the fetched `origin/main` before invoking Commit Policy, and fail on missing
or ambiguous ancestry. Queue runs use their event `merge_group.base_sha`. An empty
`--from` falls back to bootstrap history and loses
the ancestry needed to recognize already-released upstream package syncs.

`scripts/check-conventional-commits.ts` rejected a `mockup:` subject in CI after the agent pushed — the check was deterministic, ~1s, and documented nowhere agents read. Now `pnpm verify` (commit policy vs the `origin/main` merge base + typecheck + lint + unit tests) runs in the husky pre-push hook for feature branches; `prepush:main` still guards pushes to `main`.

- OpenWaggle is an Electron desktop coding-agent UI on top of Pi.
- Main-process architecture is hexagonal: domain, ports, adapters, application services, IPC, stores.
- Pi SDK imports belong in `src/main/adapters/pi/` only.
- Provider/model/auth metadata must mirror Pi through `ModelRuntime`, project-scoped runtime services, and OpenWaggle-owned ports.
- OpenWaggle must not maintain a parallel `src/main/providers/` registry.
- OpenWaggle extension UI direction is ADR-0006: model visual contributions as surface/runtime/execution, default to a framework-neutral federated-module runtime with `mount(context)`, and do not expand placeholder route/content experiments as a parallel legacy runtime.

## Pi Runtime Memory

- Pi 0.84.4 emits `agent_end` with `willRetry: true` for a transient assistant error, then `auto_retry_start`. If the retry delay is stopped, Pi emits `auto_retry_end` with `finalError: "Retry cancelled"`; this is cancellation, not a provider failure. Preserve `willRetry` and cancellation separately in transport events, and give the run's aborted state priority over any error retained in Pi history. Pi's default HTTP idle timeout is five minutes; Undici may report a stalled or closed streaming connection as `terminated`, which Pi considers retryable. Classify that as a provider connection failure while retaining the raw detail.

Load `.agents/skills/pi-integration/SKILL.md` for details.

- Pi JSONL sessions are runtime state; SQLite session projection is the product read model for renderer navigation, branching, persistence, active runs, and UI state.
- Pi-native tool events, thinking levels, compaction behavior, session ids, provider/model ids, and auth methods should stay Pi-native through the adapter boundary.
- Composer thinking choices must come from Pi's `getSupportedThinkingLevels(model)` result. Render that array exactly: `Off`, `Extra High`, and `Max` appear only when Pi declares them for the selected model; never infer levels from model ids.
- Missing projected Pi entries during clean-cut projection rebuilds should be treated as stale/cancelled navigation, not thrown through IPC.
- Preserve Pi-created session ids before first prompt by opening the pre-created id correctly instead of allowing a missing JSONL path to create a different id.
- Build runtime services through Pi's project-scoped service path so extensions/providers are registered before model resolution.
- Pi package extension loading must be scoped to the active project and adapter cwd so package extensions do not read Electron's process cwd or leak server processes.
- OpenWaggle masks user-managed `pi-mcp-adapter` npm entries from its embedded Pi SettingsManager at read time and restores them on writes; never uninstall or remove those shared entries because standalone Pi and other projects may still use them.
- OpenWaggle-owned Pi extension packages must be bundled/copied locally and `asarUnpack`ed for packaged apps.
- Pi lazy-loads some Node-only modules through a bundler-opaque variable-specifier dynamic import (e.g. the Amazon Bedrock Converse impl and the OAuth flow loaders) so browser/Bun bundlers cannot pull in the Node-only deps. OpenWaggle bundles pi-ai into the Electron main chunk with `codeSplitting: false`, so those specifiers resolve next to `out/main/index.js` where no chunk was emitted, failing at runtime with `Cannot find module .../out/main/<name>.js` — packaged-only, and only when that provider/flow is actually exercised. The fix is Pi's static-override escape hatch, registered before first use: `registerPiBundledOAuthFlows()` (`pi-bundled-oauth.ts`, `setBedrockProviderModule`→`pi-bundled-bedrock.ts`), called at `runtime.ts` module load AND at the ModelRuntime construction chokepoint in `pi-provider-catalog.ts` (idempotent). Every other provider uses a literal-string dynamic import that rolldown inlines fine — Bedrock was the last opaque one. Any new Pi lazy loader needs the same registration or it regresses the same way.
- Pi-native Waggle state belongs to `@openwaggle/pi-waggle`: runtime custom message/state types use the `pi-waggle.*` namespace, branch mode/config is stored as `pi-waggle.mode-state` custom entries, and OpenWaggle should project metadata from those entries instead of seeding a parallel metadata tree.
- Pi TUI Waggle continuation turns should be scheduled after the current Pi run settles, then append the visible `pi-waggle.turn` custom message and call `sendUserMessage(...)` without `deliverAs`; queuing continuation prompts with `deliverAs: 'followUp'` during `turn_end` can leave them waiting for user confirmation. Accumulate tool-call turns with their `toolResults` before advancing, and use `agent_end` only as a fallback for pending tool-call-only completions.
- User-authored input during an active Pi TUI Waggle run must stop automatic Waggle continuation and be resent with `sendUserMessage(..., { deliverAs: 'steer' })`; otherwise Pi rejects it with “Agent is already processing” because normal prompts during streaming need an explicit streaming behavior.
- Pi custom TUI components must use `@earendil-works/pi-tui` keyboard helpers such as `matchesKey`/`parseKey` instead of raw escape-sequence comparisons; Kitty keyboard protocol encodes Enter, Esc, Space, and Ctrl+C as CSI-u sequences, so raw checks can trap users inside custom menus.
- Pi custom TUI components must never return strings containing embedded `\n`/`\r`; normalize dynamic labels/details to single terminal lines before rendering. They must also truncate rendered lines with `truncateToWidth`/`visibleWidth`, not string length, clamp scroll windows to `items.length - visibleRows`, and reserve fixed blank slots for scrollable lists/details. Embedded newlines, overflowing lines, or shrinking terminal output can corrupt Pi TUI's differential cursor math and leave duplicated-looking rows. Prefer Pi's built-in `ctx.ui.select` for modal menus unless custom rendering is clearly needed, so the Pi footer/status remains visible and interaction steps do not visually jump.

- First-turn injection is measured with `pnpm exec tsx scripts/benchmark-first-turn-tokens.ts` (`--live --no-skills --second-turn --provider openrouter --model z-ai/glm-5.3-flash`). On bundled Pi 0.84.4 in a plain empty project with a fresh `PI_CODING_AGENT_DIR`, OpenWaggle injects 1609 turn-1 tokens on GLM-5.3-flash (+13 per trivial follow-up turn; the 0.81.1 runtime measured 1576). Pi unconditionally discovers user skills from `~/.agents/skills` (agentskills.io convention) even with a fresh agent dir; the 13 local user skills add roughly another 1.4k estimated tokens, so pass the loader `noSkills` (or CLI `--no-skills`) when you want the bare-harness number.  Equal-footing OpenRouter/z-ai-glm-5.3-flash comparisons (2026-09-02, pristine pinned Docker containers via `scripts/benchmark-docker/run.sh`, wire-truth from the logging proxy): Pi CLI 0.84.4 1356, OpenWaggle bundled 0.81.1 1576 via its native provider (1319 when routed as a raw openai-completions endpoint), Reasonix 1.35.0 5279 on the wire (its CLI reports 10558 because it re-sends the conversation to a completion validator - report the wire), opencode 1.18.26 7054, Codex CLI 0.150.1 9957 (Responses endpoint needs `model_reasoning_effort` set or OpenRouter rejects the bare `reasoning.summary`), Claude Code 2.1.247 17608 (a run against the real user home measured 22260 - installed plugins alone added ~4650 tokens, which is why the container harness matters; native Bedrock opus via `cc-w` measured 16911). Cross-harness turn-1 injection varies ~13x with the same model. Routing notes: Codex needs a custom `[model_providers.*]` with `wire_api = "responses"` AND `model_reasoning_effort` set, because OpenRouter's Responses endpoint rejects a bare `reasoning.summary`; opencode takes an `@ai-sdk/openai-compatible` provider in an isolated `XDG_CONFIG_HOME`; Gemini CLI 0.31 cannot be routed (auth types are Google-only and the user's Code-Assist-for-individuals tier is deprecated); Cursor CLI is login-walled and speaks Cursor's proprietary protocol, so it cannot be pointed at OpenRouter. A local forwarding proxy in front of OpenRouter is the reliable way to observe per-call prompt_tokens when a harness aggregates or rewrites usage; it must stream chunks through incrementally (buffering whole SSE responses makes agents time out and retry ~13x, which poisons CLI-reported sums). The full reproducible harness (pinned-version Dockerfile, per-agent configs, streaming proxy, results parser) ships in `scripts/benchmark-docker/` and feeds `website/src/data/benchmark-results.json` -> `benchmarks.ts` for the docs page at `/docs/using-openwaggle/token-benchmarks` (a decision demoted the section off the landing page: aider at 587 and DeepSeek Harness sdk-minimal at 1115 beat OpenWaggle's 1609 on turn-1 injection, so no superlative claim is defensible; OpenWaggle stays in the lean tier, 6-11x lighter than Codex and Claude Code). A task-efficiency benchmark (same model, same small self-judging tasks, tokens-per-solved-task, e.g. on aider's exercise set) was scoped and parked as a possible v2. The repository-standards guard forbids the legacy vendor runtime name; benchmark files are recorded as exempt in `scripts/standards/forbidden-references.ts` because the benchmark must name its subjects. Measuring headless agents requires isolated homes: `PI_CODING_AGENT_DIR`, temp `CODEX_HOME` with a symlinked `auth.json`, and `--setting-sources`/`--bare` break Claude's OAuth refresh, so only `--disable-slash-commands` plus `--strict-mcp-config` is safe there.

### Pi entry ids are only unique within one file (ADR 0049)

`session_nodes.id` is a global key and node ids are Pi entry ids. Pi's stock eight-character ids collided across Sessions once the database held ~80k nodes: one reused id made every later snapshot of that Session fail with `UNIQUE constraint failed: session_nodes.id`, shown as "This response couldn't be saved", and the projection stopped at the collision while the Pi file kept everything. The Pi patch now mints full UUIDs. `persistSessionSnapshotWithSql` checks for ids held by other Sessions first and fails with `SessionNodeIdConflictError` (names the id and its owner); the Session repository then renames those entries in the Pi file through the `SessionTranscriptRepair` port (`repairForeignSnapshotEntryIds`) and saves again. The rewrite refuses unparseable files and files that changed meanwhile, and only re-projects changed entries. Anything that reads a node id from the snapshot after saving (turn-checkpoint anchors) must resolve it against the saved tree. Never key anything new by a Pi entry id alone, and scope every `session_nodes` write by `session_id`.

### A Session's recorded Pi file is only a hint until its first run settles

Preparation records the file of a manager it creates in the opened checkout, but Pi writes a file only on the first assistant message, and the first run opens its own manager in the run directory (the worktree, for a worktree Session), so Pi writes a differently named file elsewhere. That file is recorded only when the run's snapshot is saved. A Host that stopped during a Session's first run left it pointing at a file that never existed, and the next run started an empty transcript under the same Pi session id, silently dropping the conversation. `createSessionManagerForSession` now looks for `*_<piSessionId>.jsonl` in the Pi session directories of the run directory, the recorded path, the Session's checkout and its worktree before starting fresh, and logs a warning, once per Session, when a Session that already has an assistant reply still has no file. It does not merge Sessions that already started over on a second file before this fix; the newest file wins. Deleting a Session removes every `*_<piSessionId>.jsonl` in those same directories (`findPiSessionFiles`, through the `SessionTranscriptFiles` port), not only the recorded file; the deletion journal records the newest copy for a Session with no recorded file, because after the Session row is gone that file name is the only record of its Pi session id.

## MCP Runtime Memory

- MCP is an OpenWaggle-owned runtime capability, not a Pi extension. Keep protocol lifecycle, configuration, transport, trust, authentication, capability discovery, and server hosting behind OpenWaggle ports/adapters; Pi receives only the compact gateway tools for an active turn.
- MCP activation resolves session → project → global and defaults off globally. Disabled servers must not connect, inject instructions/capabilities, or remain attached after the safe turn boundary; the UI must distinguish desired, applied, and pending state.
- Interoperate with current MCP (`2026-07-28`) and the supported legacy revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`) across both client and hosted-server paths. Preserve protocol/transport negotiation diagnostics instead of silently dropping older servers.
- Treat remote MCP content as untrusted: require explicit trust and capability opt-ins, keep Event Inbox and server instructions out of context until reviewed, sandbox MCP Apps, isolate sampling, keep roots read-only, validate Remote Skills, and surface every required user or agent follow-up as a durable notice.
- The owning Session Host is also the authority for MCP configuration, pooled connection status, capability browsing, Tasks, Events, secrets, logout, and interactive OAuth. GUI and CLI clients route every MCP mutation through Host-backed operations; OAuth may open the browser from the detached Electron Host, but resolving the server definition, committing credentials, and reconciling clients stay under one owner-process writer lease. Expanding Host-backed MCP channels requires a new Local Session protocol revision so an older detached Host is upgraded before the GUI sends a channel it cannot decode.
- MCP credential or configuration reconciliation must not interrupt an active turn, but it must mark every active runtime namespace for deferred invalidation. Close those connections immediately after turn completion so the next turn reconnects; preserving them merely because the config-derived snapshot revision is unchanged can reuse revoked credentials indefinitely. Management reads hold a reader lease until external MCP work actually settles, connection-closing tombstones outlive cancelled callers, and Session calls must match the authoritative snapshot identity established at lifecycle boundaries. MCP App calls and resource discovery additionally bind to the server config hash captured in the App descriptor so approval cannot retarget after configuration replacement.
- Runtime OAuth refresh, explicit authorization, and logout share a per-server generation authority. Logout advances a revocation tombstone before its serialized vault removal, so a refresh already committing is removed afterward and an older provider cannot recreate credentials. Interactive authorization owns the next generation and cancellation must abort the callback listener and network exchange before releasing the MCP management writer.
- MCP connections stay per Session (ADR 0013), but a turn must not wait for optional direct-tool servers. Measured cold connects are 10–15s (atlassian, chrome-devtools, figma, playwright) against ~10ms for a warm turn. Codex (`codex-rs/codex-mcp`) keeps per-thread connections too and hides the wait with a process-wide tool catalog cache plus a 1s grace for optional servers; OpenWaggle mirrors that (`runtime-direct-catalog.ts`) with a 1.5s grace. The tool list cache (`encrypted-tool-catalog-cache.ts`, app data `mcp/tool-catalogs.json`, so channels never share it) is keyed by project + server instance + config hash + sandbox + grants, holds only optional direct-tool servers' selected tools (name/title/description/inputSchema), seals each entry with its key, and is forgotten per server on logout, re-authorization (before and after) and removal, and entirely on any secret change. Handles hash the input schema, and `resolveToolHandle` trusts a handle only while the Session's fresh listing contains it: a background listing that lands before the call must not turn a cached handle into a trusted live one (four reviewers found that bypass). One listing runs per connection key (`startServerListing`), started under the lifecycle lock. Closing a slot aborts its in-flight connect (`McpConnectionFactoryInput.signal`) and the writer does not wait for it to settle, because a background connect outlives its turn and a writer that awaited it held the Host-wide lifecycle lock for up to 15s. The abort must close the transport as well as the client: during the SDK's `auto` version-negotiation probe the transport is not attached to the client yet, so `client.close()` alone is a no-op (tested with a real `Client` in `mcp-connect-abort.unit.test.ts`). A connect ended by retirement is not reported as a failure and clears its own still-connecting notice. A Session's last connect failure is kept in `connectFailures` (keyed by config hash), not inferred from notices, which reconciles clear and the grace notice overwrites. Forgetting a server's lists also marks its open connection attempts (`forgottenAttempts`, a WeakSet of each cell's abort signal, not the reusable slot key), since listings over them still speak for the old credentials; a closing slot's listing is never remembered. The Host shutdown (`closeAll`) is the one close that waits for aborted connects to be torn down (≤5 s), and `connectUnlessAborted` rejects only after teardown, or a still-booting stdio server outlives `app.exit`. `CatalogTool` no longer carries a connection: callers resolve the Session's current one with `getConnectionForServer`. Waits inside `withAuthoritativeSnapshot` run uninterruptibly, so a timeout there must wrap an `Effect.interruptible` wait or it never fires early. Hidden QA hides first-party Pi tools unless started with `OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS=1`.
- Never serialize MCP binary payloads into model-facing tool text. Base64 tokenizes at ~1.6 characters per token, so one Chrome DevTools screenshot (433,816 characters) added ~271k tokens and overflowed a 458,752-token window in a single tool step; Pi's chars/4 estimate predicted only ~108k, so the pre-sampling threshold could not catch it. MCP tool results forward images as native Pi image content (bounded per result, numbered markers in the text; Pi downgrades them for text-only models) and replace audio, blob, data-URI, and opaque base64 data with size markers (`src/shared/utils/mcp-binary-payload.ts`, also used for MCP App draft text). `details` keeps the complete result for attribution, MCP Apps, and the UI; Session Resource capture scans only that MCP copy so a screenshot is cataloged once.

## Electron Runtime Memory

Load `.agents/skills/electron-runtime/SKILL.md` for details.

- Native addons have separate Node and Electron ABI targets. Rebuild with the repo scripts before blaming app code.
- xterm 6.0 stable lacks Kitty keyboard-protocol negotiation. The terminal pins the supply-chain-aged `@xterm/xterm@6.1.0-beta.303` exactly and enables `vtExtensions.kittyKeyboard`; a real-DOM test covers legacy-before-negotiation plus CSI-u press/release after `CSI > 3 u`. xterm calls custom key handlers on keydown and keyup in this line, so every app-owned/clipboard keydown must retain `event.code` and swallow its paired release or report-event-types clients receive an orphan keyup. Move back to stable only after those protocol tests and real-Electron performance/IME QA pass.
- Packaged apps may not inherit a shell PATH. Pi package/resource loading and Pi-run child processes that shell out to tools need an adapter-controlled npm-compatible PATH, including common user tool dirs such as `~/Library/pnpm` on macOS.
- `electron-builder` with pnpm can omit transitive runtime modules unless explicit dependencies are present; `ms` is intentionally explicit for `electron-updater`.
- macOS `electron-updater` requires ZIP artifacts in GitHub release metadata; DMG-only mac releases can advertise an update but fail with "ZIP file not provided".
- Squirrel.Mac counts every process with the app's bundle id *and* bundle path as a running instance (`NSRunningApplication`, accessory/`UIElement` included): the detached Session Host and any `openwaggle` CLI process (`mcp serve`, `sessions wait`) from `/Applications/OpenWaggle.app` block an install. ShipIt waits for the instances it sees at start, then re-checks after verifying the update and aborts with `SQRLInstallerErrorDomain -9 "App Still Running"` if any is there, which is exactly what reopening the old version during the install window does. Evidence lives in `~/Library/Caches/com.openwaggle.app.ShipIt/ShipIt_stderr.log` (local time) and `ShipItState.plist` (JSON despite its name; it survives a successful install). Every install path (Restart to update, `openwaggle update`, `install.sh`) therefore stops the Host first with a `purpose: 'update'` stop (ADR 0047). `install.sh` must run the installed CLI with `</dev/null` (under `curl … | bash` stdin is the rest of the script), so `host stop --update` asks on `/dev/tty` through `tty.ReadStream`; a plain `fs.createReadStream('/dev/tty')` keeps a pending threadpool read that can stop the process exiting. To check counting without a GUI, start an isolated Host from the installed bundle (`OPENWAGGLE_USER_DATA_DIR=<tmp> /Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle sessions list`, with `OPENWAGGLE_AGENT_RUN` unset) and enumerate `NSRunningApplication.runningApplicationsWithBundleIdentifier('com.openwaggle.app')` through `osascript -l JavaScript`.
- On macOS 26, `NSWorkspace.iconForFile` returns the icon as the Dock draws it, including the grey tile macOS puts behind icons that do not fill the rounded-square grid. Render a throwaway `.app` bundle holding a candidate `.icns` through it to check an icon without touching the Dock. The macOS icons come from `scripts/generate-macos-icons.ts` (Apple's 1024 grid: 824 px continuous-corner tile, 100 px margin); Windows/Linux keep the free-form mark.
- On Apple silicon, performance/package QA should use arm64 outputs, not Rosetta x64 output from a universal build folder.
- Electron Playwright E2E requires isolated user data and single-instance lock opt-out when another OpenWaggle instance is running.
- Agent-run Electron E2E and QA have a hard non-disruption contract: the app must not show or focus a BrowserWindow, open a native dialog, or launch an external application. Automated paths fail instead of exposing OS UI; visible Electron QA requires an explicit headed command.
- `pnpm dev:debug` is the non-disruptive CDP automation entry point. Visible CDP QA is opt-in through `pnpm dev:debug:headed`; `pnpm dev` remains the normal visible development command.
- Hidden `pnpm dev:debug` uses an ephemeral user-data directory and disables the single-instance lock. It must not focus an existing OpenWaggle process or read and write the normal development profile.
- Hidden agent QA owns CDP port 9223; port 9222 remains available for visible/manual debugging. The hidden launcher preflights 9223 and fails before launching Electron if another process owns it.
- Hidden QA also requires a per-run identity in the renderer URL before accepting a CDP page. Port preflight alone is racy and must never be treated as proof that the connected process belongs to the launcher.
- The non-disruption contract is enforced inside the main process, not only by launch scripts. OS-visible Electron actions go through an automation policy that fails closed, and repository standards reject new unguarded window-show/focus, native-dialog, and external-application call sites.
- Trusted-main and discovered Pi runtime extensions are not loaded during non-disruptive automation. Electron exposes its window constructors as non-configurable module properties, so dynamically imported extension code cannot be brought inside the repository's static hidden-window construction boundary. Pi skills, prompts, themes, context, models, and auth metadata still load. Packaged Hive QA may explicitly retain host-supplied first-party inline factories so the native Sessions tool is exercised while discovered global/project extensions remain disabled.
- Agent-run headed Electron QA requires the maintainer's explicit approval for that exact run. An agent cannot infer permission from a task needing native-UI coverage or from approval granted to an earlier run.
- `pnpm dev:debug` is a managed hidden-QA launcher. It owns the Electron child process, exclusive port-9223 lease, ephemeral profile, log forwarding, signal handling, stale-dead-process metadata recovery, and profile cleanup.
- Managed launchers serialize lease recovery and acquisition, quarantine stale leases before deletion, pass only an allowlisted child environment, and always continue through process-tree cleanup when screenshot capture fails. Windows cleanup uses `taskkill /T /F`; POSIX cleanup signals the detached process group.
- The hidden-QA profile registers the current worktree as its selected project and starts with no fabricated sessions. Feature-specific tests or QA scripts add deterministic fixtures explicitly.
- Every scripted Electron launch is non-disruptive, including E2E, CDP QA, startup measurement, and website screenshot capture. The only visible paths are ordinary `pnpm dev` and explicitly headed commands; agent use of any headed path still requires exact-run approval.
- Regression coverage proves hidden windows remain invisible and unfocused, guarded OS-UI calls fail, Playwright headed intent reaches Electron, port conflicts fail before launch, managed cleanup removes the ephemeral profile, and repository checks reject new unguarded OS-UI call sites.
- Every completed agent-run Electron QA captures representative screenshots from the hidden window, stores the evidence outside the repository, and renders the images in the final user response. QA evidence is never committed; intentional visual-regression baselines remain a separate test asset.
- On macOS Electron 43, hidden-window `page.screenshot()` and `BrowserWindow.capturePage()` can omit a native Browser WebContentsView even when its page is loaded and interactive. For website captures, capture the real renderer and guest separately through Playwright at CSS-pixel scale, verify the guest dimensions against `window.contentView.children` bounds, and composite those pixels at the recorded coordinates. Keep the original images and bounds outside the repository, disclose the composite in the evidence, and visually inspect the result; a successful capture call alone does not prove the Browser content appears.
- CI runs hidden-window functional Electron E2E on macOS, Linux under Xvfb, and Windows. Xvfb requires both `DISPLAY` and `XAUTHORITY` in the safe Electron child environment. Native pixel baselines stay Darwin-only and are selected with the `@visual` tag; do not copy them across operating systems.
- Linux launches forward an explicit parent `--no-sandbox` switch to the detached Session Host without disabling the sandbox by default. Electron retains runtime switches in `process.argv`; normalize only recognized leading runtime switches before the development app path or canonical command. Never search payloads for command words or remove application options. Startup QA records a bounded tail from the existing GUI stderr pipe and detaches on settlement, leaving detached Host stdio and lifetime independent.
- Detached QA Session Hosts can become unreachable zombies: `releaseQaLease` deletes the whole temp profile (including `host.sock`) while the Host outlives the QA client, which was observed as 10 idle `session-host-internal` Electron processes (≈400MB each, hours old) with default-Electron Dock tiles. The Host now self-reaps when its endpoint socket file disappears (`watchUnadoptableSessionHostEndpoint`) and runs with `setActivationPolicy('accessory')`. Do not call `app.dock.setIcon` at runtime: LaunchServices registers a second Dock tile on every packaged launch; packaged icon comes from the bundle's Info.plist. Those Hosts also never idled out before ADR 0047: the Host re-read the setting every second and `updateIdleGracePeriod` restarted the timer each time, and semantic discovery acquired and released a `semantic-preparation` owner every two seconds, which also restarted it. Only a changed value reschedules now, and `semantic-preparation` is idle-clock-neutral (it holds the Host while it works but does not reset the idle time). A Host from 1.0.0-beta.9 stayed up past 900 s idle; the fixed one exits at the 300 s grace.
- Linux Electron 43.2 can pass client control pipes and Chromium sockets to detached children despite `stdio: 'ignore'`; explicit ignored entries for descriptors 3 and 4 also failed real Ubuntu QA. Detached launch maps descriptors 3 through a validated `/proc/self/fd` snapshot maximum to an owned null-device handle, including holes. Reserve the null source at or above that maximum: mapping a low source repeatedly makes libuv allocate temporary duplicates and fails with `EMFILE` for a valid sparse descriptor set under a low file limit. Release the intermediate owned reservations before spawn so libuv has room for its launch pipe; retaining them failed with descriptor 62 under a 64-descriptor limit. Keep only the high source through synchronous spawn and release it in the finalizer. Failure cleanup never closes original parent descriptors. Missing or invalid snapshots fail closed; this descriptor remapping is Linux-only. The synchronous snapshot does not prevent native threads opening higher descriptors before spawn. A pending Playwright close is not proof that the GUI process remains alive; the detached Host can retain its control and CDP sockets after GUI exit.
- Windows Electron 43.2 also leaks inherited client handles through a detached `stdio: 'ignore'` launch. A native regression through the production launch function proves that the parent exits successfully while stdout, stderr and control pipes 3/4 stay open until its detached child exits. The Windows headless launcher uses a short-lived hidden PowerShell helper and `CreateProcessW` with handle inheritance disabled. The helper inherits the intended Host environment; dynamic arguments travel through UTF-8 stdin, never interpolated helper code or diagnostics. Decode that input with an explicit UTF-8 reader, since detached Windows PowerShell cannot rely on a console code page. Do not override the helper's execution policy or silently fall back to direct Electron spawn. Keep the native regression's child alive while asserting both parent exit and all five pipe closures, plus exact Unicode argument and environment round trips. Playwright's Windows process PID belongs to its `cmd.exe` wrapper; a missing wrapper PID is not sufficient evidence about Electron or its inherited handles.
- Renderer project labels receive native filesystem paths. Derive their final segment through the shared `projectName` formatter, which handles both `/` and `\\`; splitting only on `/` exposes full Windows paths and breaks project-scoped controls.
- Playwright pointer delivery into a sandboxed iframe is not portable when the Electron window is hidden: macOS can activate a framed button while Linux/Windows silently leave its handler untouched. For framed controls, dispatch the DOM activation inside the frame, assert synchronously that the handler entered its busy state, then poll a durable boundary such as the project-scoped extension-storage row. Main-renderer controls should keep using normal Playwright pointer actions, and the fixture unit test should cover transient banner text.
- Electron 43 can stall a secure custom-protocol iframe indefinitely when its document response includes `Origin-Agent-Cluster: ?1`. Inline visualizations isolate siblings with a fresh UUID custom-protocol host per frame instead; do not restore the header without proving navigation in real Electron.
- A sandboxed custom-protocol iframe can self-navigate to a blank or failed document without delivering a reliable cancellable Electron frame-navigation event. Inline visualizations therefore pair navigation guards with a post-load host-protocol health check and replace an unresponsive frame with a safe fallback.
- A parser-blocking visualization can prevent `load` entirely, so its deadline must be armed before assigning `src`. Authenticate the injected runtime with a credential-bearing bootstrap sent from the head before fragment parsing, but do not clear the deadline until a matching ready arrives at `DOMContentLoaded`; otherwise fragment code can win a first-ready race. Keep visualization sites out of process and use a low-frequency authenticated heartbeat for later silent navigation. Expiry should remove the isolated iframe; do not send an OS kill signal to its renderer, because macOS Electron can surface that child-renderer crash as a crash of the containing Playwright page.
- Inline visualization references are detected in two forms: the legacy private-use-delimited wire form (U+E200/`visualize`/U+E202 payload U+E201, matchable anywhere) and the delimiter-free bare form the visible skill template teaches (`visualize{"path":…}` alone on its line, strict payload parse). Authoring models cannot reliably reproduce invisible private-use characters, so never make a model-facing contract depend on them; the renderer streaming scan, the shared extractor, the ownership predicates (which run over serialized content JSON and must decode text parts first), and the snapshot SQL prefilter all cover both forms.
- A hidden screenshot failure does not authorize headed QA. The agent reports the incomplete evidence and asks for exact-run approval before using any headed fallback.
- CDP file upload can produce `File` objects without native paths; native file-path behavior needs preload/unit coverage or real OS selection QA.
- **The Windows NSIS script is only compiled when electron-builder packages Windows, which happens in the release workflow, not CI.** An installer-variant StrFunc call inside `customUnInstall` broke two consecutive releases across six days before anyone noticed, because NSIS only rejects it at compile time. `build/installer.nsh` is now compile-checked by `pnpm check:installer` inside `pnpm check`, so it fails a pull request in seconds instead of a release in minutes. Two NSIS rules worth remembering: StrFunc helpers must be declared before use, and an uninstall section can only Call `un.`-prefixed functions, so `customUnInstall` needs the `Un` variants (`${UnStrRep}`, not `${StrRep}`).
- GitHub's release-asset storage (`release-assets.githubusercontent.com`) sometimes returns a transient HTTP 500 for a healthy, fully uploaded asset. `curl -f` without `--retry` aborts `scripts/install.sh`, and with it `openwaggle update`, on the first such response. Every network `curl` in the installer goes through `curl_with_retry`, which retries timeouts, 408, 429 and 5xx with exponential backoff and still fails on the first 404. `quick-installer-download-retry.unit.test.ts` runs real curl against a local server that fails once.
- Electron's `app.exit()` is forceful and does not wait for piped `process.stdout` or `process.stderr` writes. Every Electron CLI entrypoint must await the shared output barrier before exiting; otherwise Linux automation and real machine consumers can receive only Electron's empty startup payload while the versioned OpenWaggle response is lost.
- Windows Electron 43 rejects a URI-like argument followed by another token before any literal `--` boundary, returning unsigned exit `4294967295` before application JavaScript runs. Capability names such as `sessions:read` trigger this native URL guard just like URLs. The installed `.cmd` shim must invoke `OpenWaggle.exe -- ...`; development automation uses `electron <app-path> -- ...`. Application routing consumes exactly that one canonical transport separator and preserves subsequent payloads and user terminators. Keep the native raw-versus-bounded fixture: this failure is not a Session Host policy or credential-storage rejection.
- Top-level invocation routing lives in `top-level-cli-route.ts` and only ever inspects the first application argument. No arguments opens the GUI; `help`/`-h`/`--help` and `version`/`-v`/`-V`/`--version` are answered before `app.whenReady()`; a command group delegates to its `*-cli-entry.ts`; an existing directory (or a file's folder) opens the GUI on that project. Every other bare word, single-dash option, stray `--`, case variant or near-miss of `--help`/`--version` (including bare `--h`/`--v`; `--v=N` is Chromium's vlog switch), and, in packaged builds only, an unknown long switch followed by a bare word, prints the usage to stderr with exit 2. Other long switches must keep starting the GUI: Playwright (`--inspect=0 --remote-debugging-port=0 .` in development), `dev:debug`, startup measurement, NSIS `--updated`, and the automation lock-denied marker all pass them first; `top-level-cli-launch-shapes.unit.test.ts` runs the real argv shapes through `applicationCliArguments` and the router together. Every non-GUI route sets the macOS activation policy to `accessory` so a CLI never shows a Dock icon.
- `openwaggle <path>` reaches a running app through `requestSingleInstanceLock({ openProjectPath })` additional data (`claimAppInstance` in `open-project-requests.ts`); a macOS app with no window creates one once startup finished. Canonicalize with `realpathSync.native`, like the folder picker: the JS `realpathSync` keeps the typed letter case and created duplicate recent projects. The renderer pulls the request with `project:take-open-request` once settings are loaded (so a request made before the window loads is not lost and a reload cannot repeat it), opens requests one at a time, and reuses the sidebar's `openProjectInDraft`.
- `openwaggle run` subscribes to the unfiltered Host event stream before sending `launch`, buffers events (skipping Sessions already in the subscription's active-run snapshot, capped) until the launch response names the Session, and settles on the `run-settled`/`follow-up-started` event for its Run. A replaced Run, a replayed launch, a missing `terminalStatus`, a lost stream, and any other state change for the Session are reconciled by reading the Session's recent `turns`, because those end a Run without a settlement event naming it. Electron turns SIGINT/SIGTERM into an app quit, so `listenForInterrupts` holds `before-quit` and de-duplicates the signal/quit pair; readline in raw mode turns Ctrl-C at the approval prompt into a readline `SIGINT` event instead. stdout and stderr share one ordered queue (a synchronous stderr write overtook the queued newline ending a reply line), and agent-controlled terminal text (`terminal-text.ts`) shows control characters, bidi controls, and every default-ignorable, `Cf`, `Zl`, and `Zp` character as visible `\x1b`/`\u202e` escapes, except a ZWJ between two emoji, ZWJ/ZWNJ between letters of Arabic, Syriac, N'Ko, Mongolian, or Indic scripts, FE0E/FE0F after an emoji (after a digit, `#`, or `*` only in a keycap), and the three RGI subdivision flags. TTY replies hold their last grapheme (`Intl.Segmenter`, at most 64 code units) until the next delta and pass it to the sanitizer as lookahead, so an emoji or joiner split across deltas is not escaped; deleting a CSI sequence up to its final byte hid real command text (`ls \x1b[;./0m -la`).
- A Run that failed before reaching Pi (authority, execution profile, project config, or Run context loading) used to settle as `failed` with no event carrying the reason; `publishRunStartFailure` now ends it with an `agent_end` error. Local Session server errors from Effect tagged errors without a message used to reach clients as "An error has occurred"; `describeLocalSessionServerError` now names the tag, code, operation, and bounded cause chain. That surfaced `SessionLifecyclePreparationError (initiating-workspace-not-found)` for any CLI `create`/`launch` whose working directory was outside the target project: `current` now resolves the ready Workspace containing the caller's directory, and falls back to the named project's checkout.
- `openwaggle host stop` sends the revision-19 `local-host-v1` contract, handled in the Session Host bootstrap before normal dispatch and allowed only for `local-user:` callers without a profile. It calls `liveness.requestDrain('stop')`, the same graceful drain an upgrade uses, so active Runs finish and new work is refused; the GUI's renderer recovery starts a new Host afterwards. `--wait` polls until the Host stops answering or a new Host instance id appears. Every drain still admits the commands that end work (`local-session-drain-admission.ts`: reads except waits, interrupt, request/approval respond, queue-pause, export-cancel, compaction and Waggle cancel, Action `stop`/`stop-setup`/`output` decoded from the `{ kind: 'value', value }` Host UI wire arguments, the desktop app's read-only Host UI requests from `host-ui-read-only-invocation.ts` except the ones that start MCP servers or load Pi resources, which can run extensions and install packages, further stops) through `liveness.acquire('operation', { whileDraining: true })`, which still holds the Host open until the response is written; without that a Run waiting on an approval kept a drain open forever (ADR 0039). Queued Follow-ups still start during any drain under the coordinator's existing Run lease; pausing queues on stop was rejected because a `host-lost`-paused empty queue swallows later Follow-ups and Worker Delegations settle on an intermediate result.

## Pi Compaction Memory

- Automatic compaction is one app-global percentage, default 80%, injected into Pi after project settings merge. Strip the injected `thresholdPercent` before Pi persists project settings; otherwise the global preference leaks into project configuration and becomes an accidental override.
- Native compaction is an explicit model-transport capability, never an inference from provider name or generic Responses support. The canonical Responses `output` is opaque durable data and must contain a valid compaction item before a new boundary is appended.
- A native checkpoint identity includes both the effective credential-resolved model endpoint and the effective compaction endpoint. Resolve auth only when an active native checkpoint needs that identity; if credential refresh is unavailable, keep read-only restoration working by reconstructing authoritative raw history. A fallback startup or model switch must never call the source model or replay its checkpoint to a different endpoint. Treat the compact endpoint as an external boundary: persist a checkpoint only when every canonical replacement item matches a supported Responses message or compaction shape, with exactly one final compaction item.
- The Pi JSONL branch stays append-only and authoritative. Incompatible targets reconstruct raw entries, trim only the oldest complete model-facing units when the target hard window requires it, and append a deduplicated reconstruction-boundary diagnostic without deleting source entries.
- Codex-like scheduling defers idle compaction: check before a new user turn, and after a tool/model step only when another model call follows. Large tool-call/result pairs are atomic recent-tail units.
- Treat Native compaction `404`, `405`, and `501` responses as standards-level evidence that the declared endpoint is unavailable and use the provider-neutral Portable mechanism. Rebuild that fallback projection from append-only raw history rather than reusing an opaque Native checkpoint preparation. Authentication, quota, cancellation, malformed output, and exhausted transient failures remain visible Native failures.
- The composer context meter follows Codex-style authoritative usage events after each valid completed provider response, including intermediate tool-use responses. It does not invent per-token usage while a provider stream is open, publish error/aborted/zero-usage responses, or combine one model's usage with another model's context window. A successful compaction marks usage unknown until the next valid response.
- Incompatible native-checkpoint reconstruction must be fitted again at the provider-call boundary with the active system prompt, serialized tool schemas, pending messages, and output allowance reserved. A fixed percentage alone can overflow the first request after switching to a smaller model.
- Compaction progress belongs in the transcript, not in a composer dock. Match Codex's running and completed copy, retain manual-versus-automatic reason through Pi session projection, and use motion only on the active label with a reduced-motion fallback.
- ADR 0048: the transcript shows the whole selected branch in Pi log order (`buildPiTranscriptPath` in `src/shared/utils/session-entry-paths.ts`), feeding both Session detail `messages` and workspace `transcriptPath`, with every compaction marker and branch summary where Pi appended it. The model's context stays Pi's own `buildSessionContext`; `buildPiModelContextPath` only mirrors Pi's entry selection for a compatible checkpoint (checked against Pi in `compacted-history-projection.integration.test.ts`) and must never decide what the transcript shows. Showing the model context (compaction first, then kept entries) made a manual `/compact` marker vanish: the refetched detail acknowledged the live row while the stale workspace path lacked the summary, then the marker reappeared at the top and every summarized message (all of them for a Native `firstKeptEntryId: 'native-replacement'`) was gone. Actions above a marker work through Pi's tree: a branch, or edit and resend, moves Pi's leaf, and that branch's context has no later compaction.
- Keep the message queue generic during compaction. A normal send remains queued; only an explicit Steer moves that item into the transcript as a pending preview, and Pi's live run control delivers it with `sendUserMessage(..., { deliverAs: 'steer' })` after compaction finishes without cancelling or replacing the active turn.
- Filter transient one-turn visualization context at every compaction boundary: Native checkpoints, Portable summaries, and Native endpoint fallback. Use a pure compaction-only transform rather than replaying Pi's general `context` extension chain; Portable splits the turn into summary and prefix arrays, so the filter needs the full prepared context as a reference, and overflow retry must explicitly retain the active prompt's state. Transform a Portable fallback lazily only after the Native endpoint selects it.
- Standalone manual compactions are Host-owned active activities even though they have no agent stream buffer. Route activity restoration to the owner, rebuild their running transcript state after renderer remounts, and discard stale snapshots when a live lifecycle event wins during async initialization. Publish the terminal event after releasing the writer but synchronously before its successor resumes; the GUI bridge emits normal run-completed even if it missed compaction_start. Preflight failures must also settle restored activity.
- These changes require Pi core/provider patches, not an extension. On each Pi upgrade, regenerate both pnpm patches and re-audit generated model capability metadata, cold resume, repeated native replay, malformed native output, portable tail fit, and tool-loop scheduling.

## Renderer And Session Memory

- The transcript window is addressed by row key, never by a count of hidden rows (ADR 0036, superseding ADR 0022). A count set at mount sliced unrelated lists: a branch switch from 400 to 60 messages showed one row, and a window mounted before hydration built every row. Reconcile the window during render so a changed list never paints a frame of the old window, and key the viewport by Session and branch.
- All transcript scroll rules live in `transcript-viewport-controller.ts`, with the held sent turn's policy in `SentTurnHold` (`transcript-sent-turn.ts`: measurement, persisted-copy pairing, crossing latch, work judgement, reserved space). They sit behind a geometry interface and are unit-tested there. The block-layout jsdom harness (`transcript-layout.test-harness.ts`) covers only the hook wiring. A browser clamp from shrinking content fires a scroll event that must not read as the reader scrolling up. Resting exactly at the end always rejoins it: the live end, or a held turn whose reserved space ends there.
- A sent turn is held near the top until its content reaches the bottom of the viewport, as in the Codex desktop agent thread (`local-conversation-thread-*.js`: follow modes `static`, `prework_watch`, `prework_follow`, `user_follow`). A turn that is working when it crosses (tool calls, Waggle; judged over the whole held turn by `turnHasWork`) is followed from there. A plain answer stays held below the fold, even if work starts after it crossed; following it then jumped a mid-answer reader to the end (`SentTurnHold.crossesWhileWorking` latches the crossing). Never release the hold, or drop the reserved end space, while the turn is still shorter than the viewport. The browser clamps `scrollTop` and the whole turn jumps down the screen, which was the old tool-call handoff. The controller keeps a `SentTurnHold` (`transcript-sent-turn.ts`) that outlives `new-turn` mode and tracks the turn's height under a reader inside it. It moves only to the persisted copy of the message, which `persistedSentKey` finds by position: the user row right after the row that precedes the message, tracked while the message is mounted because a finished run's refresh can re-key it. Taking the latest user row picked a steer at run completion, or the previous turn's message after a refused or queued send. Re-placing on a steer pinned the steer while the running output grew above it. A send anchors its own optimistic row. `PendingSend` records the latest user message when the send begins, and `pendingSentRowKey` picks the first optimistic id after it. An optimistic id alone is not proof of a pending send: `reconcileSnapshotUserMessages` keeps optimistic ids on persisted messages for stable React identity. Inferring the send from key changes failed in three ways: the flag can commit before the optimistic row, a new Session's viewport mounts with the row already present, and a capped window's `showNewest` commit consumed the change. `usePendingSendStore` keeps it per Session outside React: the chat panel remounts for a new Session's route (panel state was lost, so a new Session's first message was never held, on `main` too), and `useSendMessage` moves the draft's send to the created Session. That Session's viewport also remounts when its branch id arrives (`S:main` becomes `S:S:main`), so the viewport consumes the send only once the branch is known (`canConsumePendingSend`), and the hook anchors once per mount. Leaving a Session clears its pending send: `chat-store.ts`, the owner of `activeSessionId`, subscribes and calls `clearSession`. The pending-send store has no runtime dependency on the chat store; subscribing from its side ran inside a circular import (the chat store's actions import feature barrels that import back into chat) and broke dozens of test files. The transcript content column has `min-h-full`: measure content up to the end space (`transcript-viewport-geometry.ts`), never the min-height slack, or a held turn near the top of a short Session is clamped down the screen. Found in real-Electron QA with a per-frame after-paint sampler; jsdom cannot show either. A held turn bounds the window like a follower does (`boundsLikeFollower`), or a full 160-row window caps the reply out from under the message.
- Reading positions are saved per (Session, branch) as a row key plus viewport offset (`openwaggle:transcript-reading-positions:v2`). Pixel offsets landed on different messages once the window reopened at its newest rows.
- A just-completed turn's optimistic user message is replaced by its persisted node under a new id, so anything keyed by user message id (fold expansion) must alias the pair; `turn-fold-aliases.ts` does this from the live list's `metadata.sessionNodeId`. Assistant messages from the stream also change id on the snapshot refresh, which remounts that turn's rows once.
- Keep row-level props identity-stable across streamed tokens: rebuild derived messages only when their source changes, and keep the row render context and context-provider values stable by content. A context value rebuilt per render re-renders every consumer in every mounted row on every token.
- Judge renderer performance on a production build (`electron-vite build` then `electron-vite preview`). Dev builds made 140-row streaming look janky (p95 frame 117ms) while production stayed at 9-10ms.
- When counting re-rendered components from `onCommitFiberRoot`, skip subtrees whose `child` equals `alternate.child`: React reused them, and their `PerformedWork` flags are stale. Counting them overstated per-token renders by about 5x.
- Snapshot `created_order` values are not stable per node. Pi entries use their Pi index, and every snapshot renumbers durable agent-loop nodes (`:agent-loop:` ids) after them. So a turn that adds fewer Pi entries than a Session has agent-loop nodes shifts them onto slots that other rows still hold. SQLite checks `UNIQUE (session_id, created_order)` row by row, so in-place rewrites failed with `SQLITE_CONSTRAINT_UNIQUE` ("This response couldn't be saved" in Hive Workers driven by follow-ups). Node reconciliation now parks moving rows at negative orders first. Any change to node rewriting must survive `session-snapshot-created-order-shift.integration.test.ts`, and the park predicate is unit-tested in `snapshot-node-reconciliation.unit.test.ts`.
- That same `created_order` instability breaks readers that assume append-only ordering, in two different ways. `session_resource_backfill_state.through_created_order` is a durable monotonic high-water mark and its page reads `created_order > cursor`, so once agent-loop nodes are renumbered above new Pi entries, those Pi entries land below the cursor and their resources never enter the catalog. The tree-scoped `sessions` items high-water mark is captured per query, so there the same instability only skews an in-flight pagination rather than permanently dropping rows. Both are pre-existing, not fixed by the parking change; the real fix is a stable ordering for non-Pi nodes.

- Composer editing must wait until the selected Session workspace and its scoped draft context are applied. Session detail can arrive earlier; accepting input in that gap lets workspace hydration replace a new draft. A new-session composer does not require a workspace.
- Persisted Session draft keys use the matching workspace's canonical nullable project path, not asynchronously updated global project preferences. Otherwise a late preference update can clear text after the composer is already editable. Branch-summary prompts capture that nullable owner at creation. Keep exact draft/prompt identity through preference reads, summarization, and final workspace refresh before restoring or clearing a draft. Only new-Session drafts follow the global selected project.
- Branch-from-message must resolve a canonical node in the active Session before creating a draft. User retries use that node's real parent, including hidden nodes; a missing projection is not a root-user node. Reconciled optimistic rows retain their UI IDs, so their canonical `sessionNodeCreatedOrder` metadata can identify the persisted node. Late workspace reads must not replace a different Session, route, or draft selected meanwhile.
- Pi reopens a session file at its last entry and keeps tree navigation in memory, and OpenWaggle opens a fresh Pi session for every operation. A branch switch or a no-summary retry is a separate Pi operation from the run that follows, so runs used to continue whichever branch was written last: the message landed on another branch than the one on screen and the model answered from that branch's context. `SessionDetail.resumePosition` carries the projection's `last_active_node_id` plus the Pi entry count it was derived from (agent-loop audit nodes excluded), and `createSessionManagerForSession` branches to it only while the file still has exactly that many entries; a file with unseen entries (host loss, a failed snapshot) keeps its own position.
- `session_nodes.id` is a global primary key, but Pi fork files keep the source entry ids, so every fork and clone failed with `UNIQUE constraint failed: session_nodes.id` (ADR 0041). The fork file is re-keyed before projection. GUI message actions must resolve the persisted node, not the message id: a row sent in the current window keeps its optimistic id after reconciliation, and Pi rejects it as a fork target. The loaded `SessionWorkspace` is not refreshed after a run, so fork and clone read the Host workspace again for a just-sent message or the current branch head. Inline visualizations live in the rendering Session's store, so the Host fork path must set `visualizationSessionId` on copied assistant messages (via the fork's new→source id map); without it a fork showed "The visualization source is outside this session."
- Branch derivation claims saved branch rows for every head by ancestry before any start-node fallback. A retry inside a saved non-main branch shares that branch's earliest-fork start node; matching by start let the new head take the saved row and the snapshot failed with `UNIQUE constraint failed: session_branches.id`. New branch fallback names are the first free `Branch N`: numbering by head position named every newly selected branch `Branch 2`.
- A retry draft is set before its navigation drops the routed `branch`, so the route effect sees the old branch on the draft's first render. Clearing the draft there lost every retry started from a sidebar-selected branch (no summary prompt, and the message went to the branch head). After a send, the routed `node` is dropped so the view follows the branch head; kept, it hid the new turn after a reload.
- Prepared attachment metadata must fit the strict renderer transport schema, including any truncation marker. Long-paste previews stay bounded; submission resolves the complete original UTF-8 text from the Host-owned immutable snapshot, never from a renderer-provided preview or a reopened source file.
- Pi prompt text and image blocks are model input, not the durable display model: persist source-free original user parts beside normal prompts, steering, and visible Waggle requests, then project those parts instead of synthesized `[Attachment: ...]` or `[Image input: ...]` artifacts. Reconciled optimistic rows must acquire the durable Session node id so captured image resources can replace transient blob previews without duplicating the user turn.
- Session Host authority uses an OS-held exclusive lock in a dedicated persistent `<databasePath>.ownership.sqlite` file. Never delete or replace this file during ownership or recovery. SQLite releases the lock on process death and retains it during synchronous cutovers with no JS heartbeat. An authenticated older Host draining for upgrade must close before replacement.
- Pre-cutover restore must stage the recovery database copy before installing the legacy source path, then roll back the preserved active database on any copy or cutover failure. Install the source without replacing an occupied path, and remove that path on rollback only when this restore created it. A failed copy after renaming the active database otherwise leaves the canonical path missing.
- Detached startup's 10-second orphan check applies only before the Host has accepted any authenticated client. Record adoption monotonically in liveness; a later GUI restart gap must follow the configured idle grace, not the startup deadline. A one-time owner-count check killed already-adopted Hosts during otherwise clean GUI restarts. The real CLI regression authenticates once, disconnects for 12 seconds, and checks that the same Host still answers. Never-adopted, ownerless Hosts must still stop at the orphan deadline.
- QA profile cleanup removes private data while ownership is held and retains the tiny ownership-file skeleton permanently. Preserve its exact SQLite `-journal`, `-wal`, and `-shm` companions too: exclusive locking can retain an open rollback journal after COMMIT, and unlinking it fails with `EBUSY` on Windows or removes a live SQLite file on POSIX. Let SQLite manage those files. Cleanup must not unlink the ownership inode or its companions after release either: a successor may already have acquired them. Similar-prefix files and the transcript database's separate journals are not part of this preserved skeleton.
- A classic Run deferred behind another writer still needs an exact Run-ID cancellation reservation. Cancellation releases its successor claim and settles the durable Run without aborting the preceding writer. Stop bypasses the attachment/command serialization locks held by pending steering, but retains admission, authorization, and journal fences; completion of an accepted promotion removes the delivered item from the same stopping Run to prevent duplicate replay.
- Export recovery must not scan history or touch artifacts before the Host listener opens. Capture a rowid watermark, fence execution claims, and recover bounded source-row pages in a scoped background worker. A cancelled page retains cleanup receipts; Host drain stops retries and releases the recovery lease.
- Selected-path export checkpoints use revisioned, resumable repair with bounded source reads and checkpoint writes per transaction. Yield between batches and preserve cancellation; never expose a partly rebuilt revision. Semantic scope reuse and refresh must be atomic, including policy shrink and expired-lease eviction.
- Compaction integration must preserve Session Control as the owner of durable Follow-ups and steering. Carry compaction/retry activity snapshots through the Local Session transport so an attached GUI restores the same activity as the Host.
- Pi steering acceptance is not transcript delivery. Session Control carries a bounded queued/handled receipt with the first eligible native entry order captured after compaction, before queueing, and a hash of the projected first user text block after Pi transformations. Visible transcript indexes shrink during compaction and optimistic user IDs change on reconnect; neither is an authoritative delivery boundary. Preserve canonical node order through UI conversion and React row-identity reconciliation. Keep previews through long tools and consult session-scoped activity before clearing on idle during navigation. Historical journal successes without receipts remain explicit unavailable receipts, never re-executed mutations.
- The Host publishes each user message the moment Pi incorporates it: a transport `message_start` with role `user` and `userMessage` (display parts, `sessionNodeCreatedOrder`, `durableTextSha256`, `waggleInvocation`), validated by `agent-transport-user-message.ts` at the Local Session boundary. It is emitted from Pi's user `message_end`, not `message_start`: Pi notifies listeners of the end before appending the entry, and by then the `openwaggle-user-input` projection is recorded as the nearest non-message ancestor of the coming entry, so parts, log order, and digest equal the persisted node whatever the listener subscription order (`user-message-events.ts`; if Pi has already appended, the entry holding the same message object is used). Visible Waggle user requests are custom messages that an idle session appends before notifying, so they are located by the message's own content and details references. A contract test against a real `AgentSession` pins this to `projectPiSessionSnapshot`. The renderer inserts the row unless a row with that log order and the same digest or text is shown, and an unrecorded optimistic send with the same text takes the identity instead (a queued send's row then survives `forgetQueuedSend`). Steer promotion waits for durable delivery, so its receipt arrives just after the incorporated row: a preview awaiting its receipt is hidden behind an incorporated row with its Follow-up's typed text and attachment count for display only, and only the receipt's boundary and digest record the pairing (`steer-preview-matching.ts`). The stream buffer retains the Run's incorporated user messages with their timestamp and the answer they followed, so a reconnect orders a steer read after the streaming answer's tools below that answer. A row published live carries `liveIncorporated` until a persisted snapshot row names its node: its id is a stream id, so reconciliation must never record it as `sessionNodeId`. A user message without a recorded projection shows only its typed text, live and in the snapshot alike (`piUserContentToDisplayParts` drops the synthesized `[Attachment: …]` blocks).
- An Undelivered steering message returns to the front of the Follow-up queue when its Run ends without incorporating it (Stop, interrupt, replacement, failure, or a natural end where Pi skipped it). Pi `abort()` does not clear `AgentSession`'s steering queue, but each Run's Pi session is disposed, so OpenWaggle owns the return. Every Session Control steer passes a `SteeringDelivery` (`promoted-follow-up` id, or `steer` with the Follow-up it would become: submitted intent, caller, steer idempotency key, a fresh Follow-up id). `pi-steer-delivery-ledger.ts` records them in arrival order; at unregister, entries still awaiting handoff or queued with no matching `message_start` candidate are retained per Run, and the coordinators (`takeUndeliveredSteers`) pass them to `lifecycle.settle`, whose `returnUndeliveredSteers` prepends them before pausing or scheduling, bypassing queue capacity. A message Pi started is never returned: a promotion whose message started before the Run ended counts as delivered even if Pi never persisted it. A direct steer still waiting for compaction, or queued only after the Run unregistered, is refused to its caller rather than returned. With a pending replacement, settlement persists the return without bumping the state revision, so the replacement's published revision stays exact. Queued direct steers keep their attachments: `cleanupUnreferenced` retains `steer` journal inputs whose `steered-run` Run is still live. Host loss returns nothing, because the in-memory delivery ledger is gone and returning could duplicate.
- Undelivered steering settlement, as revised (it supersedes the bullet above where they differ; an explicit Waggle displacing the Run returns its steers too): Every steer passes a required `SteeringDelivery` (`promoted-follow-up` id, or `steer` with the Follow-up it would become: text, attachments, visualization context, caller, the steer's idempotency key, `returnedSteer.runId`, a fresh id; never Waggle, thinking level, or authorization override, which a steer cannot carry). `pi-steer-delivery-ledger.ts` records them in arrival order as a stage union (`awaiting-handoff`, `handing-off` with the tracker snapshot taken once earlier steers reached Pi, `queued`, `settled`); at unregister it keeps per Run those Pi never started (no matching `message_start` candidate). Coordinators settle through `settleWithUndeliveredSteers`: read, settle, then forget, so a failed settlement keeps them. `lifecycle.settle` prepends them (bumping both revisions) before pausing or scheduling; when the Run no longer owns the Session (pending replacement, `replaceWithExternal`, already idle) it still persists them, pauses a queue stranded on an idle Session, and returns `stateRevision` on the rejection, which the coordinator publishes as `steers-returned`. Replacement records its outcome from the final state via the journal's `outcomeForFinalState`, and `releaseRejectedRunInterruption` pauses a stranded queue. A message Pi started is never returned: a started promotion counts as delivered, and a direct steer Pi queued after unregister is accepted if started, otherwise refused (as is one still in the tail or waiting for compaction). Queued direct steers keep their attachments while their Run is live (`referencedSessionAttachmentIds` includes their journal inputs); settlement releases the delivered ones (`releaseDeliveredSteerAttachments`). Overflow is bounded: direct steers need queue room at admission and the ledger holds at most `MAX_RETURNED_STEER_OVERFLOW` returnable ones per Run, so queue-id commands accept `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS`. `queue-list` items expose `returnedSteer { runId, idempotencyKey }` so the steer's caller does not resend it. Host loss returns nothing, because the in-memory ledger is gone and returning could duplicate.
- Worktree birth fetches the chosen base branch from `origin` first (`src/main/adapters/git/remote-sync.ts`, `session-branch-freshness.ts`) and births from `origin/<base>` when the local branch is an ancestor of or equal to the remote tip; a local branch ahead of or diverged from the remote keeps its own tip, and fetch failures degrade to the recorded refs. Local-mode sessions run one best-effort `pull --ff-only` in `runPiAgentKernel` before their first run (`session.messages` empty), never on later turns. Birth tests mock `./session-branch-freshness`; its policy has its own unit tests.
- Routine Git status revalidation (turn boundaries, focus, broadcasts) must keep the status already on screen, and its loaded state, until the new answer lands; only a changed working tree clears it. Flipping to "Checking Git status" / "Checking PR status" on every refresh made the Session Summary flash each turn.
- Sidebar search/filter results are Host page snapshots; they must drop rows on the Host's `session-list-changed` archived/deleted events, or an archived session stays listed and the archive looks like it failed.
- Sidebar Git refresh effects must depend on the semantic working-path set, not the identity of a rebuilt Session array. Concurrent Git status reads share a pending request only within the same invalidation generation; loading-state publication must not trigger another refresh. A real Electron diff fixture exposed thousands of Git processes from this feedback loop despite completed-result caching.
- Sidebar stabilization and status deduplication do not stop a route-level read-receipt loop. Persisting a visit broadcasts a Host Session update, which replaces the renderer detail object. Mark visits on navigation, not detail identity, and refresh route Git data only when its working or repository path changes. A bounded replay previously produced six receipt writes and six branch-list reads from five echoed receipts; it now produces one of each.
- Renderer state that represents chat transcripts or active runs must be keyed by concrete `SessionId`, not only the active route.
- The attached GUI uses isolated in-memory persistence. Workspace authorization and visualization ownership must read the authoritative Host, not GUI-local Session repositories. Root checks use indexed exact lookups with bounded legacy-alias pages; a failed or retired Host never authorizes a fallback from stale local data. Client visualization reads must not recover deletion tombstones, because only the owner knows which deletions are active. Serialize owner preparation and staged deletion per Session, independently of the Pi tree writer so active-run visualizations can still load. Canonical Host deletion must perform visualization cleanup; an IPC-only wrapper is bypassed by remote routing. Its protected finalizer also publishes deletion invalidation after cancellation. Projection errors can follow a committed database deletion, so probe owner existence before restoring staged files; a failed probe keeps files quarantined for owner recovery.
- Interrupted E2E fixtures seed both `session_runs` and `session_active_runs` within the Session transaction. Sidebar rows can read the branch projection while exact filter counts read the canonical Run; seeding only one produces contradictory UI state.
- Restoring an archived Session can make its archived branches visible in the separate paginated branch query. Invalidate that exact query after successful restoration as well as refreshing the Session catalog; failed restoration preserves both caches.
- Hive cleanup archives a Worker only when its Delegation is `accepted`/`cancelled`, it is idle (no active Run, Follow-up, pending authorization, in-memory writer, or parked interaction), its own Delegations are terminal, and no user ever touched it. "User" means any non-`session-agent:` caller: the append-only `session_operations` journal under the Worker id *and* under `delegation:<contract>:actor:*` (a CLI accept/revision/reopen is a review), plus the agent-authored `spawn` row. Pins and branch edits are `local-ui-v1`, not journaled, and skip command serialization: a pin protects only while it exists, and the final archive re-derives the whole predicate plus `liveSessionAuthorityBlockReason` for the spawning caller inside its own write transaction (the Host's single SQLite connection serializes it against the pin). Unjournaled desktop state also counts as user activity and keeps the Worker: any terminal record for the owner (or a truncated snapshot), a registered browser-preview owner (the Session is open in the GUI) or live previews, and running `service` actions when the Worker is its Workspace's last active binding. Terminal/browser checks run inside the archive's desktop mutation fence via the `admit` hook of `withSessionDesktopRemoval`; the service check runs inside the Workspace action mutation. The broker answers `getActivitySnapshot`/`browser inspectOwner` offline only with native-free proof. Triggers: agent-caller delegation accept/cancel (a pass for the Delegation's parent, which also reaches a nested parent Worker) and any Run settling with nothing scheduled. The archive key is `hive-cleanup:<delegation>:<updated_at>`, so a parent-agent unarchive replays instead of re-archiving. Any caller's (user or agent) accepted `message`/`start`/`follow-up`/`replace`/`steer` to a Worker whose latest archive-state operation is a cleanup archive unarchives it inside that command's serialization, attributed to the caller (`hive-restore:<key>`); a `delegation-reopen`/`delegation-request-revision` that lands in `revision_requested` does the same for the Worker, taking the Worker's serialization inside the parent's (parent before Worker; lineage is a tree). Explicit archives are left alone. An agent-restored Worker stays visible until a new terminal transition, because the old cleanup key replays. `HiveWorkerCleanup` is looked up with `Effect.serviceOption`; a runtime without `HiveWorkerCleanupServicesLive` silently disables cleanup and restore.
- Interrupted sidebar pages are authoritative for Run state, not for text matching. After hydration, apply the same title/project-alias and archived predicates as terminal-state pages, and preserve pagination even when a page has no text matches.
- Every Session creation path, including Session Control `create`, `launch`, and `spawn`, must persist the canonical empty `main` branch, its branch state, tree UI state, and `last_active_branch_id` before a Run can start. `session_active_runs.branch_id` is a foreign key; a metadata-only Session is visible in discovery but fails before Pi receives its first prompt.
- Local Session command transport timeouts must cover the operation's declared long-poll window plus a response grace period. The default 10-second socket timeout is correct for ordinary commands but must not truncate `wait`, `exports-wait`, or freshness-blocking search requests that legitimately wait longer. Steer and Promote may await automatic compaction; like manual compaction, they have no default response deadline, while preserving an explicitly requested client deadline.
- E2E and diagnostic code that opens the application database must use the canonical Session Host database path (`session-host/session-host.sqlite`) through the shared fixture/path helper. `userData/openwaggle.db` is only the pre-cutover source and is absent for a fresh profile.
- Switching away from a foreground run should demote it to background state, not reject the send promise as an error.
- Active-run UI continuity needs a renderer-owned render snapshot keyed by session id; persisted run metadata alone does not prove visible reasoning/tool rows remain continuous.
- A Run's nodes reach `session_nodes` only when it ends (`persistSnapshot` in `agent-run-service.ts`), and the reconnect stream buffer resets its parts at every assistant `message_start`, so mid-Run neither the Host detail nor `agent:get-background-run` holds the Run's earlier answers. Only the renderer render snapshot does. `useBackgroundRunMonitor` therefore seeds one on `agent_start` for a Session no route has rendered (`runRenderSnapshotForEvent`, `seededByRunId`). It is reseeded when a different Run starts and kept across an auto-retry's repeated `agent_start`. A seed that names no Run (a reconnect-synthesized `remote-snapshot:<id>` start, or `unnamed-run` from a compaction_start without a snapshot or an init restore) takes the next real runId instead of being reseeded. Every run-completed (continues or not) marks the Session's snapshot, route-owned ones included, as holding a settled Run (`settledRunId`) and drops its run-start seed; a settlement with no runId (a reconnect that finds the Session idle, a manual compaction_end) marks it too. `seededByRunId` means only "seeded by this Run's start" and `settledRunId` only "holds a settled Run"; they must never share one field again, or a compaction between a settle and the next start makes hydration treat a settled Run as the active one and shows its answers twice. The next `agent_start` always reseeds a settled snapshot. The snapshot remembers the message ids it held when the Run settled (`settledMessageIds`) across route writes; hydration and the reconnect merge leave those rows to the persisted transcript only once it clearly holds that Run (each settled user row persisted under its id or at the same `sessionNodeCreatedOrder`), and otherwise keep them, so a stale detail never loses messages. Without this, a snapshot left by a route that rendered the Run kept its answers under stream ids, which never match the persisted Pi entry ids, and reopening showed them twice. A seeded snapshot holds only its Run's messages, so hydration appends them after the persisted history (`placeSeededRunMessages`): no text reconciliation, dedupe by id or user Session log order, compaction anchors and summary counts shifted past the history. Text reconciliation of user rows never matches rows at different `sessionNodeCreatedOrder`, because live message ids differ from Session node ids. After a non-continues refresh the snapshot is kept only if a Run that started during the refresh seeded it (`withoutSettledRunRenderSnapshot`); archive and delete clear it too. `applyAgentTransportEvent` returns its input for events that change no message; compare by reference instead of listing event types. The chat route reuses one `useAgentChat` across Sessions, so `backgroundStreamingRef` alone can still be the previous Session's while the next Session's detail loads; background events write a route transcript only when `backgroundReconnectSessionIdRef` names the event's Session, and a Session change with no detail yet resets the background state, or a running Session's events would overwrite another Worker's run-start seed. The post-refresh clear deletes only a snapshot still marked as holding the settled Run, and settled rows are judged one at a time (an unsaved optimistic user row stays). `mergeBackgroundReconnectMessages` places a message only the cached transcript holds after the message it followed, or before the first shared message, in one pass. A renderer reload mid-Run still loses the earlier answers until the Run ends.
- Agent-loop cards (interactions, notices, extension custom messages) are placed in the transcript, not appended below the newest answer (`lib/agent-loop-card-placement.ts`). A persisted card's audit chain hangs from the end of the Run that recorded it (`appendDurableAgentLoopEvents`); `readAgentLoopEventsFromWorkspace` returns that anchor message per event key, which bounds the card to its Run, and within it the card follows the last message whose `createdAt` precedes the event's Host timestamp. Live cards use the same rule from the newest message. A card never splits a tool call from its nested results and is deferred past a Waggle turn it falls inside. Audit nodes' `created_order` is renumbered on every snapshot, so never place cards by it.
- Rows are rebuilt for the whole branch on every streamed delta. `chatRowKeys` through `matchBy` cost about 15 ms per delta at 20,000 rows; message rows now take a fast path, keys are cached per row object, and `createMessageRow` / nested tool-result rows keep their identity while their inputs are unchanged (`lib/chat-message-row-model.ts`), so the key cache hits. Never mutate a row object. Per-delta resolve + rows + keys measured about 24 ms before and 11 ms after at 20,000 messages (6.3 ms to 2.6 ms at 6,000), in Node.
- Transcript order is guarded by the transcript-order harness (`features/chat/hooks/__tests__/transcript-order.*`): a Host model holds the Pi log, streams realistic transport events (tool turns, steers, promotions, queued Follow-ups with `continues`, compaction), injects Session switches, stalls with resync, slow detail reads, renderer reloads and Host restarts, and drives the real chat hooks, checking after every step that shown rows follow Pi order with no duplicates and pending steers last. Add a named scenario for every placement bug. On main, a reconnect mid-Run put retained steers right after a persisted history that lacked the Run's earlier answers, and the merge appended cached-only answers after them, so a steer jumped above the Run's earlier answers. A reconnect now places each retained user message after the answer it followed (`afterAssistantMessageId`, after earlier steers on that answer), or, when that answer is not shown, above the first answer the renderer received later; answers only the current transcript holds wait behind `earlierMessageIds` (persisted ids plus the Run's pre-first-answer user messages). Pending steer previews always render last (no captured baseline length). A Host resync forces rehydration, in place for a foreground Run. Hydration depends on the selected Session's activity boolean, not the stable `hasActiveRun` function. The Electron stream-buffer replica starts each new runId empty, like the Host's; keeping the settled Run's answer across `continues` showed it twice above the queued Follow-up. Review rounds added: answers are dated by Host event time, never the renderer clock (delivery lag otherwise moved steers above earlier answers); `BackgroundRunSnapshot.runId` is set where the Host starts the Run and carried through snapshot, decode and restore, so a restored replica still recognises another Run; a foreground reconnect merges only the buffer's rows, and a background one reads buffer, detail, buffer and keeps the result only when both buffer reads name the same Run; dropping streamed answers that the detail saved under Pi ids matches by content, one saved copy each, and only among answers saved since the reconnected Run started, because an unscoped match dropped a Run's "ok" when the previous Run had also answered "ok". The harness model repeats answer and prompt texts on purpose and fails on any received message missing while no Host read is held.
- Renderer Run lifecycle (`features/chat/lib/run-ids.ts`, `useBackgroundRunMonitor`): an `agent_start` under a runId the renderer already holds is the same Run (auto-retry or a Pi continuation after an `agent_end` without `willRetry`); `agent_end` never ends a Run, it only gives a snapshot's unnamed Run (`remote-snapshot:` start, reload restore) its real id; a Run ends only at its settlement. An agent-requested Waggle streams as `waggle-of-<X>` and settles as X (`settlingRunId`). A settlement can reach the renderer after the next Run started (writer successor, slow bridge), so the monitor keeps each Session's ordered started runIds and treats a settlement as an earlier Run's only when that Run is listed and a named Run started after it; it then only notes the snapshot and refetches. A settlement naming a Run that never started (failure before start) settles normally. Steer previews survive `agent_end` and clear at settlement or the next named start, because the Host returns untaken steers to the queue only at settlement. Each rule above came from a review round that found a lost, doubled or stuck transcript; the transcript-order model produces these Host sequences (retry, continuation, requested Waggle, failure before start, late settlement, settlement clearing the Host buffer before `run-completed` arrives) and checks liveness as well as order.
- First-message sends must bind to the concrete newly created session before async send begins; do not enqueue by current active session after users can switch projects.
- First-send worktree recovery must retain the exact submitted payload, Waggle config, and model until terminal transcript reconciliation proves delivery. Session Host command acceptance only means the supervised Run was scheduled; worktree birth and Pi execution can still fail asynchronously. Retry and Work locally replay that retained turn once; reading current composer preferences during recovery changes the user's request.
- Session tree/header refreshes for background sessions must not overwrite the active session tree/header.
- Session-native transcript rendering reads from the active `SessionWorkspace.transcriptPath`; preserve live tails only at active branch head.
- A completed run can refresh `SessionDetail` before `SessionWorkspace`. If those snapshots have no shared message ids, append the replacement detail only when its `updatedAt` proves the active-head workspace is stale; never merge a disjoint current selected-branch workspace. If a replacement Pi snapshot no longer contains the previous main head, branch derivation must adopt the new active head as the sole main branch instead of creating duplicate main/non-main branches at one head.
- TanStack Router uses hash history in Electron QA; navigate to `http://localhost:5173/#/<route>`.
- TanStack Hotkeys same-target callbacks do not stop each other via `event.stopPropagation`; independent overlays need explicit topmost ordering.
- A transient Session Summary must join the shared Escape stack and defer both Escape and pointer dismissal to foreground native dialogs. Image pinch zoom needs a canvas-local non-passive wheel listener because React delegates wheel events passively. Summary popovers must escape section clipping without losing their DOM ownership or viewport bounds; visible text alone does not prove a lower menu action can receive a click.
- Composer slash selection is owned by Lexical: keep focus in the editor, derive the active `/query` from its collapsed selection, replace or consume only that token, and serialize skill decorator nodes as `/skill-id`. Do not route `/` through a second-input global palette.
- Waggle presets in the desktop composer are one-shot invocation metadata, not idle global mode state. A standard agent hands off through the terminating `waggle_invoke` Pi tool, and the main handler chains Waggle only after the standard result is durable.
- A queued composer submission preserves its complete one-shot Waggle invocation in the durable Session Control intent and replays it through the Waggle executor under the Session's current authorization ceiling, Agent-definition allowlists, identity, capabilities, and pending upstream/downstream context. Never downgrade a queued Waggle submission into a classic Run.
- Follow-up acknowledgement is Host acceptance, not optimistic local dispatch. Pending draft ownership must survive composer unmounts and navigation; deduplicate by scoped draft identity and clear the currently mounted editor only after acknowledgement, without erasing a newer draft.
- A Session Control `message` starts a Run when the Session is idle and its queue will not deliver on its own (empty, paused, or head needing attention); otherwise it appends a Follow-up and `agent:send-message` reports `queued` (the renderer then hands back the displaced foreground state, `useAgentChat.foreground-run.ts`). Before this, a failed Run's paused queue swallowed every later message and the renderer waited forever for a `run-completed` (Stop and "Thinking" over an idle Session). A failed/interrupted Run pauses only Follow-ups accepted up to its terminal `agent_end` (`terminalEventAt`, Session Control clock, vs `intent.acceptedAt`); one accepted after it is an explicit retry: the first such item starts at settlement, and the queue pauses only if earlier items remain (`planRunSettlement`). The pause reason (`run-failed`, `run-interrupted`, `run-timed-out`, `parent-limit`, `host-lost`, `profile-revoked`, `requested`) is stored in `session_control_states.queue_pause_reason` (migration 62; set on running->paused, cleared on resume) and returned by `queue-list`/`status`.
- Follow-up edits (ADR 0044, Local Session revision 21, capability `sessions:follow-up-edit-v1`) are three journaled Session Control ops: `queue-edit-begin` -> `follow-up-edit-held` {holdId, queueRevision, leaseExpiresAt}, `queue-edit-save` {holdId, expectedQueueRevision, input: text/attachmentIds/waggle?/visualizationContext?}, `queue-edit-cancel` {holdId}. Only `gui:local-user` without a profile may edit (`follow_up_edit_requires_desktop_user`), and only a Follow-up that caller queued itself, not one it adopted (`canEditFollowUp`: `callerId` matches and there is no `authorCallerId`): attachments resolve under the author (`authorCallerId ?? callerId`). Timeout, `acceptedAt`, and idempotency key never change; a Follow-up has no thinking level or authorization override. A save names the revision its edit began at (`editHold.baseQueueRevision`), not the queue's current one: while held only the holder changes the item, and anything else that changes it ends the hold (withdrawal, delivery, adoption by another caller), so reorders and other items never refuse a save. Cancelling a gone hold is an accepted no-op.
- Local Session revision 22 (`events:run-snapshot-content-v1`): active Run snapshot text and reasoning parts carry `contentIndex` so the Host buffer splits an answer the way the live view does, and reconnect merges match parts by identity (tool id, stepId) instead of position. Parts are exact-decoded, so revision-21 clients are refused at the handshake rather than failing on a snapshot. `degraded.messageCutShort` says whether the caps cut the streaming message, because `omittedBytes` is Run-wide; the run-level flag made every later answer look degraded.
- Local Session revisions are assigned in merge order, not branch order. Title regeneration (ADR 0043) landed on main as revision 20 while the Follow-up edit and Session settings branch also used 20; the branch moved to 21 (`LOCAL_SESSION_REVISION_21_CAPABILITIES`, `HOST_UI_REVISION_21_REQUIRED_CHANNELS`). When syncing a branch that bumped `LOCAL_SESSION_CURRENT_REVISION`, keep main's number and renumber the branch's constants, capability list, channel list, the revision checks in both `local-session-command-revision.ts` and `local-session-client.ts`, and every `[N]` in `src/main/session-host/__tests__/*revision*` and the negotiation test (including the future-client `[N+2, N+1]` case).
- A hold (`SessionControlFollowUp.editHold`) travels with reorder and stops delivery at the held item: settlement, the failed-Run retry (which then waits as `followUpQueue.deferredRetryAfter`), resume, promotion (`follow_up_edit_held`), and a message to an idle Session whose running queue has a held head (queued behind; a paused one still starts the message). Invariant: an idle Session never keeps a runnable queue. `deliverIdleQueueHead` runs after every accepted withdraw/reorder/resume/adopt/edit-save/edit-cancel (`sqlite-session-control-queue-delivery.ts`, needs `nextRunId` on `executeMutation`; the outcome becomes `started-run`) and every settlement; if the Host cannot admit that Run the queue pauses (`parent-limit`, or no reason for the Host ceiling: older binaries throw on unknown reasons, so never add one casually). Worker Delegation settlement is deferred only while the queue runs and its head is a pending held Follow-up (`waitsOnHeldNextFollowUp`); the completed Run is kept in TEMP `session_deferred_worker_settlements` (`sqlite-deferred-worker-settlement.ts`) and settled by `settleDeferredWorkerDelegationAfterQueueChange` after any accepted queue/edit change that leaves the Session idle and no longer waiting (lost on Host restart). It runs after the change committed, so it never fails the command (logged, stays deferred), and its Hive cleanup request runs only after the Worker's command serialization is released: an inline cleanup takes that non-reentrant serialization itself. `pauseStrandedFollowUps` leaves a queue with a held head running. `returnUndeliveredSteers` drops direct steers past `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS` so a reorder can always name every id; settlement logs each drop after commit by follow-up id, caller, and idempotency key (`returned-steer-drop-report.ts`), since its caller already holds a steered-Run receipt; an edit save is refused for bytes only when it grows a queue past the cap. Startup recovery already pauses every running non-empty queue as `host-lost`.
- Holds, deferred retries, and retained edit attachments live in connection-scoped SQLite TEMP tables (`sqlite-follow-up-edit-holds.ts`), overlaid by `loadSessionControlState` and rewritten by `persistSessionControlState`: transactional with the queue, no migration, gone on Host restart. Leases are counted in Host sweeps (`missed_sweeps`, expired at `FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS` = 6 sweeps of 5 s), never clock time: Windows' monotonic clock counts across sleep, a sweep timer does not. Sweeps run only in the Host process (`startSessionHostOwnedServices`), which is the only place holds exist. Exposed `leaseExpiresAt` is a wall-clock estimate (`estimatedLeaseExpiry`); attachment retention still uses `utils/monotonic-clock.ts`. Holds are renewed every 10 s and on `powerMonitor` resume by Electron main through the unjournaled `local-ui-v1` `renew-follow-up-edit-hold`; the window tracker (`ipc/follow-up-edit-hold-window-leases.ts`) cancels a window's holds on `destroyed`/`did-navigate`/`render-process-gone`, cancels a hold whose renewal reports it lost, and releases a begin whose page changed while it was in flight (`WindowPageGenerations`). Loads ignore expired holds and renewal refuses them; the Host sweep (`follow-up-edit-hold-expiry.ts`, 5 s) advances leases (`advanceLeases`) and returns expired holds without deleting them and sends the holder's cancel (key `follow-up-edit-hold-expired:<holdId>`), whose persist removes the row, so a failed cancel retries. A replayed begin whose hold died is answered `follow_up_edit_not_held` (`validateReplay`). A draining Host still admits `renew-follow-up-edit-hold` and `queue-edit-cancel`; withdraw/reorder/adopt/edit-save/edit-cancel take the Run lease optionally and, without it, apply with `queueDeliveryAdmitted: false` (no `nextRunId`). A re-adopted edit is bound to the adopting window through `session-control:adopt-follow-up-edit` (renew, then `track`), via `useSessionFollowUpQueue().adoptEdit`, before the composer opens it. Attachments a held intent or a desktop user's save names are kept from `cleanupUnreferenced` for an hour so a retried save or a lost edit queued as new can still bind them. Renderer API: `useSessionFollowUpQueue().beginEdit/resumeEdit/adoptEdit/saveEdit/cancelEdit` (`adoptEdit` re-binds an edit; `adopt(followUpId)` is the unrelated `queue-adopt`), `isLostFollowUpEdit`, `snapshot.waitingOnEdit` (the composer must `enqueue` an explicit Waggle while it holds: the explicit Waggle contract is a journaled run-now replacement with no queued outcome, so the Host cannot queue it behind the hold).
- Follow-up edit UI (composer feature): `useQueuedMessageEditStore` keeps this window's edit per Session (`beginning`/`editing`/`saving`/`cancelling`), bound to the draft `contextKey` it began in (drafts are per branch or node; the composer is in edit mode only while that draft is visible, otherwise it shows a cancel-able "edited in another branch" note), plus the `SessionFollowUpEdit` from `beginEdit` as `based`, passed unchanged to `saveEdit`/`cancelEdit`. Every step re-checks after its await that the store still holds the same holdId. The pre-edit draft is stashed in `scopedDrafts` under `follow-up-edit:session:<id>:stash` (inside the composer store so its attachments stay owned, session-scoped so Session deletion clears it), stashed before the edit replaces it and cleared only after it is written back. Queued attachments load as chips with `path: ''` and are protected by `retainHostReferencedAttachments` until the edit ends (`releaseHostReferencedAttachments`); the Host retains attachments a hold or save names, so a non-lost rejection keeps every chip for the retry and a lost edit kept as a new draft keeps the edit's attachments (still protected while their chips stay). `composer-activity-store` counts attachment preparations and queued-submission acknowledgements; Edit and Save wait for both (and for a branch-summary prompt). Voice stop-and-send in edit mode inserts the transcript and saves (`sendAfterInsert`). `useQueuedMessageEdit` is the only adapter to the hook's edit API; `useAdoptHeldQueuedMessageEdit` (mounted by `Composer` via `mode.queuedMessagesSessionId`, retried when the visible draft changes) is the single place that re-adopts a `heldByCurrentUser` hold on an `editable` item: it awaits `refresh()` and then `resumeEdit(id)`, which reads the query cache (not the render's `query.data`) so it sees the refetch, and carries `queueRevision` from `editHold.baseQueueRevision`. While `snapshot.waitingOnEdit`, the composer routes an explicit Waggle through `onEnqueue` even when idle (`useComposerSubmission({ enqueueWaggle })`), so it cannot overtake the held message. Dock moves are anchored to a neighbour id (`moveQueuedMessage`), send the full queue order with pending steering promotions locked in their slots (re-read on retry), replay once on `queue_revision_changed`, then focus the moved grip and announce the new position. Final review fixes: a lost save whose message the refreshed queue still shows as editable (`follow_up_edit_not_held`/`_hold_mismatch`) takes a fresh hold and keeps the user's draft (`continueEdit`); only a gone message becomes a new draft, and a still-queued uneditable one keeps its place with the text offered alongside. Dismissing the edited row keeps the edited text as a draft. `composer-activity-store` is keyed by draft context (preparation counted against the draft visible when it starts, submissions against the submitting draft); a blocked Edit stays clickable and toasts why. Escape: the editor defers to the shared `useEscapeHotkey` stack (`hasEnabledEscapeHandler`), cancels an unchanged edit at once and a changed one on a second press. `clearScopedDraftsForSession/ForBranch` end matching edits (`abandonQueuedMessageEdits`: cancel the hold, forget the edit, drop its stash). Host-referenced and submitted attachment marks are released when the chip leaves every draft. Move focus waits for the committed order (layout effect on the rendered ids) because React relocating the focused row blurs it in browsers; the move announcement is re-keyed by a nonce.
- The settle gap (Pi `agent_end` -> Host `run-settled`) measured 2.8 s in this repo, 2.6 s of it `captureTurnCheckpoint`: the snapshot index was built with `read-tree HEAD`, so `git add -A` re-hashed the whole worktree. Seeding the scratch index from a copy of the real index (keeping its mtime for racy-git) cut the gap to ~0.4 s. The rest is Pi post-run quiet time (~150 ms) and persistence. The renderer shows a `finishing` status in the gap (`run-finishing-store`: terminal `agent_end` until final `run-completed` or the next `agent_start`): no Stop, no "Thinking", and a message sent then is enqueued as a Follow-up, which the retry rule starts right after settlement.
- A Run publishes one terminal `agent_end`: Pi's, classified at the adapter (`session-listener`, `run-lifecycle-failure`); the Host publishes one only when none went out (`endFailedRun`). A failure found after a clean `agent_end` (turn not saved) is reported on the settlement as `failureCode` (code only; `session-state-changed` needs just `sessions:discover`). `run-settled` and `follow-up-started` carry `runId` and `terminalStatus`; the GUI bridge emits `agent:run-completed` for both, the latter with `continues: true` (session-wide listeners ignore it). `agent:send-message` returns the started `runId`, and the renderer's foreground waiter only settles on its own Run's completion (earlier Runs' completions are forwarded to their sends; ones arriving before the id is known are held). Waggle sends still report no `runId` and take any completion.
- Workspace file UI is route-backed, but all indexing, root confinement, preview reads, optimistic-revision writes, and external-open resolution stay behind `WorkspaceFileService` in the main process.
- Turn-settle folds (ADR 0034): interruption labeling must apply only to the run's last fold unit; older turns always render "Worked for Xs" from durable checkpoint durations. A reset phase timer (0 ms) means unknown duration, never a zero-second run. `turn_checkpoints` rows are recorded even with empty diffs so durations survive restarts for turns that changed no files.
- Per-turn checkpoint rows store Pi-format `content_json` parts (`{type:'text',text}`, `{type:'tool-call',toolCall:{id,name,args,state}}`), not renderer Chat*Part format; seeding or mutating session rows with the wrong shape fails `sessions:get-workspace` projection.
- **React Compiler runs in the app build (`electron.vite.config.ts` -> `reactCompilerPreset()`) and, since this work, in the component test config too — but not in the node unit config, which renders nothing.** Any component that reads render data from a library-owned *mutable* instance can pass a suite that does not run the compiler and still render permanently stale in the real app: the compiler memoizes on referential identity, and the instance is mutated in place so its identity never changes. Hit for real with `@headless-tree` in the Changed-file navigator — `tree.getItems()` returned 262 items while zero rows reached the DOM. Fix is the scoped `'use no memo'` directive on the component that maps the mutable instance (an official compiler escape hatch, not a lint-ignore comment). See "The React Compiler now runs in component tests" below for the mechanism that now catches this class; for anything outside component tests, still treat a green suite as no evidence and verify in real Electron over CDP.
- Corollary: prefer libraries whose render input is a plain value over ones exposing a mutable instance, precisely because our tests cannot see the difference.
- A provider CLI can create a PR/MR remotely and still exit non-zero if its response is interrupted. Before surfacing create failure, resolve the exact head ref and adopt an existing request; after a successful create, retain the CLI's returned URL if the metadata lookup is transiently unavailable. This prevents duplicate requests on retry.
- Change-request creation follows the destination that actually received the push, including `pushurl`, remote branch, and repository owner. Require one compatible provider/authority/repository destination; GitHub fork creation uses `owner:branch`, recovery verifies owner/head/base, and browser fallback is withheld because it cannot verify the fork relationship. A bare local ref can target or adopt an unrelated same-named branch in the base repository.
- Hosted change-request identity accepts only network Git transports that preserve a meaningful provider authority (`http`, `https`, `ssh`, `git`, or SCP-like syntax). Never rewrite `file:` or an unknown remote-helper URL into a GitHub/GitLab web identity. A pinned push that uses command-scope `remote.<name>.pushurl` overrides must fail closed when the configured remote name contains `=`, because `git -c` would parse a different config key and silently stop pinning the approved destination.
- Main-process Git mutations are serialized by canonical checkout root, not the caller's opened subfolder. Worktree create/remove owns that same low-level boundary so IPC, first-send birth, and Session prune cannot race each other; linked worktrees remain distinct checkout identities.
- A successful commit or change request can still fail Session Output projection. The result contract exposes whether durable retry authorization was persisted; renderer actions must surface every projection failure and offer manual retry only for an authorized queued request, while retaining the remote request's browser URL.
- Session-resource run-completion invalidation is keyed by the event's Session id, not the currently opened Session. Background Sessions otherwise retain a fresh-looking cached catalog and omit newly captured resources when reopened.
- Extension resource contributions use the approved `openwaggle.resources` broker capability with explicit Session scope. Publish payloads accept only credential-free HTTPS links/images; the host derives actor, occurrence, canonical identity, and Session ownership. List results expose display metadata only—never locators, managed paths, canonical keys, or occurrence history—and invalidation events carry the affected Session id.
- Extension side panel icons (ADR 0043) are resolved only on the `extensions:list-contributions` Host UI path (`listExtensionContributionRegistryViewWithPanelIcons`); the broker and module-access paths keep using the plain registry view and never read icon files. A `{ svg }` icon is an *optional* content-hash file (`optionalFiles`, hashed with a missing/oversized marker), so the resolver can cache by content hash yet a missing icon never makes the package ineligible. The SVG is reduced by an allowlist parser in `src/main/domain/extension-panel-icon/` and painted only as a CSS mask (`ExtensionPanelIcon`), which the renderer CSP already allows through `img-src data:`.
- Session resources retain two distinct locator concepts: the original public locator for provenance/open/reveal and the host-managed path for safe rendering. Raster image status is established from stored bytes, not filenames or declared MIME; SVG remains an ordinary file rather than renderable active content.
- A remote image read refreshes its Session resource projection only after managed content materializes. Refreshing after a failed read bumps the resource revision and immediately repeats the same failed query; failures remain stable until the user explicitly retries.
- After Session Host cutover, Session-resource catalog, backfill, and managed-content reads are Host-owned: the GUI `AppDatabase` is client-isolated and cannot see durable Session nodes. Route resource operations through a revisioned Host UI contract, return only bounded validated image bytes for GUI-native clipboard/attachment/protocol actions, and never add a second database writer. Agent-emitted local Markdown images may be copied only from the Session workspace or dedicated `electron-qa-evidence`/`openwaggle-evidence` directories under the platform temp parents; never authorize the whole shared temp tree. Keep the transcript path as provenance while rendering only the managed copy.
- The desktop window's `AppDatabase` is client-isolated (`configureAppDatabaseAccess('client-isolated')` in `main/index.ts`), so any window-side `typedHandle` that reads `SessionProjectionRepository`, `SessionResourceRepository`, `SessionOutputRetryRepository`, or calls `SettingsService.update` silently sees an empty database or writes into one that disappears. That broke the Change request inspector ("This change request does not belong to the opened Session." on every open), merges, and every Session-scoped Commit/Push/Create PR from the Session Summary, whose Outputs were also lost (ADR 0048). Unit tests did not catch it because they run in owner mode. The fix pattern: a revisioned Host UI channel (`hostHandle`, or `invokeConfiguredHostUi` with a local fallback when the route is not configured) and, for window-side orchestration that relays a Host result, `relayingHandle` + `RelayedHostResult` instead of a cast. Settings reads from window-side services go through `invokeConfiguredHostUi('settings:get')`; source-control writes go through the Host's atomic `source-control:patch-settings`, as `makeSourceControlSettingsAccess` does (other settings use `settings:update`). Reproduce such bugs against `pnpm dev:debug` (set `OPENWAGGLE_QA_CDP_PORT` if 9223 is taken) by driving `window.api` over CDP, not with unit tests.
- Source-control provider resolution is `services/source-control/` (ADR 0048): never decide a provider from the hostname alone. A recognised host is kept as written so `Host github.com` → `ssh.github.com:443` SSH configs do not move it; `gh` and `glab` host lists are read from their config files (`hosts.yml`, glab `config.yml`) because `gh auth status`/`glab auth status` hit the network. Tests that assert exact git command lists must allow the resolver's read-only lookups (`isSourceControlResolverRead` in the stacked-gates harness).
- Source-control Settings are written only with `SourceControlSettingsAccess.patch` (per-entry set/null-remove, applied serially by the process that owns the database; the window sends `source-control:patch-settings` to the Host). A whole-record `settings:update` from the window raced with Host writes and dropped entries. `git ls-remote` patterns are globs matched against the end of a ref, so `refs/pull/` matched nothing; use `refs/pull/*/head`. Remote hosts are validated (`isSourceControlHostName`) before they reach a CLI argument, a settings key, or the terminal sign-in command; a crafted remote like `https://github;id;x/o/r` was otherwise typed into a shell. Writes through the gh account runner (`runWrite`) never retry as another account. Per-project source-control keys go through `projectSettingsKey` (the main checkout), or the agent and the Session Summary use different keys for the same project. Unit and integration configs point `GH_CONFIG_DIR`/`GLAB_CONFIG_DIR` at a missing directory so tests never read the developer's sign-ins.

### Generated Session titles (ADR 0043, October 2026)

- A Session title is a stable recognition label and also a Worker report reference. `sessions.title_source` (`default | provisional | generated | manual`) decides who may replace it: initial generation writes only over `default`/`provisional`, a refinement only over the `generated` title it owes, and an explicit Regenerate over any source, each with a compare-and-set on the exact title it read; renames and explicit titles are `manual`, forks inherit as `manual`. Titles that predate migration 63 are `manual`, so generation never touches them.
- Title writes never touch `sessions.updated_at`, because the sidebar's Recent sort reads it. The rename path (`persistOrganizationMutation`, `updateSessionTitle`) used to bump it, which made a rename jump the row to the top.
- Generation never runs on a Run's or Spawn's path. Preflight does only the local Provisional-title write, then `session-title-scheduler.ts` forks the model call into the Session Host runtime installed by `installSessionTitleWorker`. Outside the Host the requests are no-ops. Spawn and an untitled launch without attachments request generation too, so a Worker queued behind the parent concurrency limit still gets a title; a request made at creation does not settle when it fails, so the first Run retries it (after a 429 burst it otherwise kept the objective forever). The first Run usually asks while the creation request still holds the `initial` claim, so a busy claim queues the latest request (`initialAgain`) to run when the claim frees, instead of dropping it; dropping it left a failed root with neither a title nor an owed refinement. A launch with attachments leaves the title to its first Run, which knows the attachment names. Title work, including Host-restart recovery, is bounded by the age of the first user message, not by `updated_at` (unarchiving or a later turn bumps it) and not by `created_at` (a Session can sit idle before its first message); a restart must not retitle a weeks-old Session.
- The Pi adapter (`pi-session-title-generator.ts`) uses a standalone `ModelRuntime.create()` with `completeSimple`, not project session services. It is cheap but cannot see providers registered only by project Pi extensions; that case falls back to keeping the Provisional title. Automatic picks the cheapest priced, text-capable, preferably non-reasoning model from the Session model's provider *and vendor line*, keeps a zero-priced Session model (subscriptions, local servers), and always falls back to the Session model. "Cheapest in the provider" alone was wrong on aggregators: for a Bedrock `eu.anthropic.claude-sonnet-4-6` Session it chose `mistral.voxtral-mini-3b` (a speech model, in another region) and on OpenRouter `openai/gpt-4.1-nano:batch`. The vendor line is everything up to the last `/`, or a Bedrock `region.vendor.` prefix; OpenRouter `:variant` ids are skipped. Background title requests share a Host-wide limit of two at a time and re-read the setting once they hold a permit, so Off stops queued requests; Regenerate, which a person waits for, skips the limit.
- Double-clicking an inactive sidebar row opens the Session on the first click and the inline rename on the second. React then commits the suspended Session switch and restores the focus it captured before it (the composer), which blurred and closed the rename. Inline title edits treat a blur within a second of starting, with no pointer or key input since, as programmatic and refocus the field; the composer also no longer autofocuses on mount while a person types in another text field. Component tests could not see this; only the real app with routing showed it.
- Models do answer "New session" for a bare greeting. The parser rejects placeholders and the initial generation then keeps the Provisional title and owes one refinement, as T3 Code does. A refinement must wait, not settle, while the first user message is not persisted yet, or a fast reply loses it.
- `pnpm evaluate:session-titles --model <provider/model> --out <dir> [--baseline <results.json>] [--initial]` runs the T3 Code-derived fixtures against a real model. Scripts compile to CommonJS under tsx, so Pi (ESM only) must be loaded with a dynamic `import()`; importing the Pi adapter statically fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Adding a Session Host migration needs three places beyond the migration list: the ID in `session-host-schema-identity.ts` plus `SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID`, and the identity in `currentIdentities` of `session-host-ledger-compatibility.ts`, or database bootstrap fails with "incompatible or mixed identities". Hand-written `CREATE TABLE sessions` fixtures in adapter tests need new columns too; cutover fixtures must keep the legacy shape.

### Session-bound terminals (ADR 0030, September 2026)

Hidden automation windows disable background throttling while preserving their secure web preferences and `show: false`. Otherwise Linux Chromium schedules animation frames at roughly 1 Hz, making a two-frame terminal geometry check take three seconds. Normal app windows retain their requested throttling policy; performance budgets remain unchanged.

Responsive sidebar layout must retain the main subtree across docked/sheet breakpoints. Replacing the docked wrapper with a fragment remounts ChatPanel and Lexical; the new editor's autofocus steals terminal input during native window resizing. Keep the docked main container mounted and switch only the sidebar presentation. The regression checks DOM identity/focus/selection plus 18 native key events during delayed zsh startup and repeated breakpoint crossings. Clearing DOM selection does not fix a remount.

node-pty 1.1.0 leaves its master-side tty.ReadStream paused in Electron. The runner now pauses deliberately before listeners attach; the service resumes only after attachment, preserving the first prompt without an output race. Integration probes must resume after installing listeners too. xterm's WebGL path failed real-Electron visible-ink checks despite correct canvas geometry, so the DOM renderer remains the release path. Do not restore another renderer without the same in-app evidence.
Terminals are keyed `(ownerKey, terminalId)` where ownerKey is the session id or `draft:<projectPath>`; the shell cwd is the session's Working path (`resolveSessionWorkingDir`), never the raw project path. Main-process ownership lives in `makeNodePtyTerminalService` -> `terminal-runtime.ts` (registry + 10ms targeted output coalescing + byte offsets + spawn generation guards) -> focused lifecycle/input actions. Terminal ids are unique across every tab owned by one group, not merely within a tab; persisted layouts and live/retained records have per-owner and application-wide caps. Scrollback persists under `userData/terminal-logs/` with SHA-256 owner/key filenames plus collision-checked metadata, private file modes, serialized mutations, and both byte and 5,000-line caps. Persisted chunks must be sanitized (strip query escape sequences and neutralize cold TUI state) or replay can answer old terminal queries or impersonate a live old TUI; the sanitizer carries incomplete escape tails across chunks. Renderer-held startup input is a bounded UTF-8 queue with a stable generation and monotonic sequence, acknowledged/deduplicated by main and retained across viewport moves, hot reload, restart, clear, and draft-owner migration. Lifecycle operations register their in-flight turn before any awaited work; input waits through context re-open, clear, restart, and owner migration, then re-resolves the terminal alias rather than writing into the old generation. It releases only after nonce-bearing zsh/Bash/fish/PowerShell/cmd prompt integration reports readiness; unknown shells expose **Send now**. Archive kills runtime trees and clears transient input/native views while retaining layout/history; permanent delete removes both. Session and worktree mutations keep an owner/path fence held through terminal cleanup so a new operation cannot repopulate state mid-delete. Pane mounts detach rather than close, one attachment owns a PTY during side/bottom moves, and output goes only to attached WebContents. macOS Playwright hotkey gotcha: use lowercase `+j`; uppercase injects Shift. The release gate covers exact 200,000-line delivery, ≤50 ms renderer long tasks, ≤16 ms p95 input dispatch, ≤50 ms pane usability, and bounded flood close/restart.

Terminal shutdown treats PIDs as reusable names, not identities. POSIX root identity is captured at spawn; Darwin signals with an identity-checked audit token and Linux with retained pidfds. The exact master/slave identity authorizes tty membership discovery, while previously observed detached descendants retain birth-checked ownership. A close request stops new membership discovery but is not physical tty-close proof. Success waits for ownership termination, native resource drain, and public final output exit. Separate POSIX reader and duplicated writer descriptors keep an in-flight fs.write from reaching a reused fd. Once termination is proven, resume a paused finite output tail so drain can complete. Never fall back to upstream Unix destroy or raw PID signaling. A child that detaches before its first reliable ownership observation is outside this ownership claim.

Windows ConPTY roots enter a per-terminal Job while suspended; WinPTY's agent enters its Job before spawning the shell. Native handle-based termination precedes a replay-safe tree-exit event, output-drain acknowledgement, off-main-thread ClosePseudoConsole, resource drain, and final public exit. The app waits for both drain and public exit. Windows metadata uses bounded asynchronous Toolhelp and IP Helper queries with no periodic PowerShell spawn. Queries remain single-flight even after a caller times out. Inspector polling schedules after completion, backs off failures to 60 seconds, and discards stale target/lifecycle results. This metadata never authorizes termination. Native installation and packaged-app probes require the patched contract and test owned descendants, I/O, final output, and a real Windows TCP listener.

Terminal file links inside the Working path open in OpenWaggle. Absolute links outside it use the remembered curated external-editor choice, preserve line and column in both CLI and macOS app-bundle fallbacks, and fail visibly when no supported editor exists; never delegate them to an arbitrary OS default application.

### Session-owned Browser preview (ADR 0031, September 2026)

Electron 43 native viewport emulation must wait for `dom-ready`. Restoring a floating preview can call `enableDeviceEmulation` before its renderer exists and synchronously crash the main process. Committed navigation and renderer loss invalidate readiness; cancelled provisional navigation does not. Track whether emulation was applied separately from its cached signature so switching to fill after navigation still disables it. Native coexistence QA covers reload, cross-document navigation, and CDP-induced renderer crash recovery.

Draft workspace migration requires a one-use receipt from successful creation of the currently selected draft. A draft-to-Session route change alone is not authority to move tabs. Fence both owners while draining admitted browser work and transferring native ownership, and redirect deferred Setup reconciliation only after native commit. Ordinary navigation must retain each owner's existing tabs and native preview identity.

Do not ignore native preview close failures during owner migration. A still-live draft ID cannot reopen under the Session owner. Retry rejected closure once, then retain unresolved browser groups and their draft grant while completing already-committed terminal ownership. Closing absent native IDs must be idempotent because launcher and restored tabs may have no native view; existing foreign IDs still reject. Registration-error visualization context must clear in a layout effect so the error UI cannot commit while stale context remains actionable.

Electron 43.2 `webContents.close()` returns before destruction. A hidden native probe saw `isDestroyed() === false` immediately and after a microtask, followed by `destroyed` roughly 0.3–2.9 ms later. Explicit preview close must await confirmed destruction with a bounded timeout, preserve ownership on live failure, and suppress only intentional content-closed events. Best-effort teardown that swallows an exception is not proof that migration can reuse the native ID.

Retained native-close records must become cleanup-only when their renderer owner retires. Hide, detach and mute before waiting for destruction; exclude them from ordinary registry lookup and reject cached or queued automation, including results after awaits. Keep navigation, popup and security-prompt denial alive until destruction even after normal record listeners are removed. Only the exact sender may retry disposal. Ordinary failed user close remains usable. Closing the last browser of an inactive Session restores its retained terminal selection separately from the active sidebar claim, without reopening an explicitly hidden panel.

A crashed or untrusted renderer cannot drive cleanup retries. Every retired preview needs main-process-owned confirmed closure and capped-backoff retries, including retirement before any user close. Retain the cleanup record until actual destruction, cancel retries on that event, and unref timers so failed cleanup cannot keep shutdown alive. Do not turn ordinary failed user close into unexpected background disposal.

Summary startup can fan out duplicate Git reads from multiple mounted consumers. A September 12 native probe recorded four status and three branch-list IPC calls for the same path, 74 Git children, and a successful local VCS result after 12 seconds without retries. Sharing pending reads reduced this to 30 children and 819–847 ms branch readiness in three native repetitions. Cap admission to a pending read at 30 seconds so a hung local Git child cannot poison future refreshes, and require pending identity before cache publication. Invalidation must include pending status paths in generation updates, and an old completion must not remove a newer pending read. Branch lists share refs across linked worktrees, so any Git mutation detaches their pending reads globally; completed lists remain uncached.

pnpm 11 can implicitly install before running scripts when workspace manifests change, including a version-only main merge. That install runs Electron's native postinstall and can collide with Node verification. Finish manifest synchronization before rebuilding for the intended runtime; use the scoped `pnpm_config_verify_deps_before_run=error` setting during coordinated checks to fail visibly instead of starting an unexpected install. Do not change global configuration or overlap native rebuilds and tests.

Native preview context menus must focus the clicked guest and pass the event's frame to `Menu.popup`; otherwise native editing roles can act on the host composer. Install the same handler on OAuth popups, dismiss it on navigation or disposal, and revoke captured spelling/image/link callbacks with a generation check. Native menu presentation belongs in `desktop-ui.ts` and its automation blocker, just like dialogs and window activation. Hidden QA can verify event routing and the blocker, but cannot establish on-screen native menu presentation.

The September 8 T3 comparison targets stable v0.0.40 and main 50a76cee. Floating previews retain the source CSS viewport as presentation-only bounds metadata; never mutate fill/fixed user intent just to scale the mini player. Preserve the user's requested size when chat temporarily shrinks, keep all eight resize handles outside native guest bounds, and test keyboard resizing. Recording prefers supported H.264 with resolution/frame-rate-aware bounded bitrate. Focused page editing uses native menu roles; background automation must never invoke the host's clipboard or undo actions.

Browser preview lifetime follows the Session, not the mounted React panel. Switching Sessions hides or detaches native views; only explicit tab close, Session deletion, renderer/window teardown, or app teardown disposes them. Electron main must authenticate each owner key to a renderer before materialization. Background opens are a two-phase request with a unique request id and monotonic generation: both renderer acknowledgement and manager-observed native creation are required, while cancellation, timeout, navigation, or teardown rejects late work. Each owner has an explicit current tab used when `tabId` is omitted.

Native view creation is asynchronous. Keep authenticated current-tab intent while creation is pending, and never substitute an older tab for that pending selection. Renderer bounds updates start only after native creation resolves. A late creation response may hide an unmounted view only when no replacement presentation owns that tab id, including a replacement using a different profile. Match this guard to the bounds IPC target, not to the narrower profile identity. Hiding an already-disposed view is idempotent; showing a missing view still fails. Owner unregistration clears only that renderer's pending selection.

Floating and fixed-viewport resize rails prevent pointer defaults to suppress selection while dragging. Explicitly focus the activated resize button, with preventScroll, or clicking it suppresses native focus and subsequent arrow keys never reach its resize handler. Test pointer activation followed by keyboard input, not only directly dispatched key events. Header dragging must not take focus.

A tab's Browser profile is its immutable Electron partition identity. Persistent profiles retain site data, Incognito never does, and switching profiles recreates the native view at the same URL. Browser imports copy bounded compatible cookies into an OpenWaggle persistent profile without modifying the source; empty results caused by a running browser, OS credentials, or filesystem authority must surface as diagnostics.

Agent Browser preview access is one fail-closed setting. When disabled or unreadable, withhold both trusted built-in `preview_*` tools and their prompt appendix, and recheck the setting inside every service operation so disabling it revokes a tool captured by an already-running turn. User controls and agent actions share the canonical CDP identity and serialized controller queue; expected synthetic input must be matched narrowly because unmatched keyboard or pointer input means the human has taken over. Cross-document navigation increments document identity so an old locator, click retry, or snapshot cannot finish against a new page. Every open, queued action, CDP command, retry, navigation, and recording handshake needs cancellation and a bounded deadline.

Recording is a main/renderer protocol, not merely a `desktopCapturer` grant: success requires the matching renderer to acknowledge a live `MediaRecorder`, and stop returns only after its bounded artifact is saved. Screenshots, recordings, element context, diagnostics, and action history have independent count and byte caps. Pi depends on the Browser preview service port; keep Electron view/CDP details in the desktop adapter so a future remote transport can preserve Session, approval, and target semantics.

## Syntax And Workspace Editing Memory

- ADR 0028 supersedes ADR 0025. OpenWaggle owns a review-first, single-active-file workspace, not an embedded IDE. The lightweight Source view owns virtualized review, Pierre owns diffs and focused editing, and shared adapters own Markdown, structured payloads, compact snippets, intentional plain text, and ANSI output.
- File review and diff review use the same right-docked `WorkspaceTreePanel`, persisted width, and `workspaceTreeOpen` shell state. Keep workspace-file loading and Git-change metadata specialized, but do not reintroduce route-local navigator chrome or a left-side file tree. Narrow editor toolbars must reserve the primary Edit/Done actions before showing metadata so the navigator cannot intercept overflowing controls.
- External file opening follows T3 Code's explicit picker model: probe a curated set of installed editor CLIs (with macOS app-bundle fallback), launch only the selected stable editor id, and remember that choice locally. Never route workspace files through the OS default-app launcher; discovery is lazy and cached so it stays off startup and file-open paths.
- Monaco, its models, editor chunks, TypeScript worker, semantic modifier-click navigation, tabs, split panes, and editor history must not return. The production build and dependency checks enforce their absence.
- The shared syntax service is the review-surface admission and scheduling boundary. It starts at most two workers after syntax-eligible content becomes visible so a large source request cannot starve compact visible code, prioritizes visible work, bounds caches, cancels superseded requests, and quarantines repeatedly failing imported grammars. A Pierre diff or focused file edit mounts one separate, bounded worker only for that explicit surface's lifetime; do not render a multi-file `CodeView` without its worker pool. Both worker builds stay module-split so grammars load on demand. Cancellation is normal control flow and never counts as a grammar failure.
- Pierre patch parsing is synchronous even when highlighting uses its worker pool. Prepare ordinary multi-file patches in renderer tasks bounded by both file count and UTF-16 input units, publishing incremental items so the first highlighted file is not blocked by the whole change set. Offload each oversized unified patch individually in a short-lived module worker rather than sending the whole mixed-size diff, and surface parser failures ahead of loading placeholders. Retain and replay Changed-file navigation until the requested item has been prepared.
- Pierre renders highlighted rows inside the open shadow root of its `<diffs-container>` element. Readiness probes must observe that shadow root rather than relying on a light-DOM `querySelector`, and the expanded Changed-file navigator must receive large file lists through deferred rendering with offscreen row layout/paint containment so secondary tree rows cannot delay the primary loading/highlight frame.
- Diff performance E2E starts inside the panel toggle's capture listener, records Pierre's first shadow-root readiness through the light-DOM `data-diff-code-ready` contract, and keeps measuring until progressive patch preparation completes. Long-task entries are selected by interval overlap because the browser task that dispatches the click starts just before the listener timestamp. A body-level code query cannot see Pierre's shadow rows, and falling back to the time when Playwright finishes polling charges startup, runner descheduling, and test-driver delay to diff rendering.
- Session resource invalidation belongs to the workspace lifecycle, not the opened ChatPanel. Invalidate the event's Session key even while another Session or Settings is open. The message-resource semaphore holds each permit until its underlying IPC call settles; aborting a TanStack observer does not cancel main-process work and must not release that permit early.
- Stop requests retain active-run ownership until the send handler captures partial resources and finalizes completion. Do not emit completion synchronously from cancellation IPC or remove its registry entry before capture. Superseding a run still uses the separate cancel-and-remove path.
- Composer drafts need a session-owned pending context before workspace hydration. Transfer typed input and attachments into the resolved branch without rebuilding Lexical, so selected slash-command chips survive. A pending context must never adopt another Session's late workspace; an untouched pending draft restores the saved branch draft.
- Pending composer keys must not use global project preferences: project selection IPC can settle before or after workspace hydration. Use Session identity while pending and the matching workspace's project path once resolved. Hosted MCP interrupt/steer must request ownership-preserving cancellation and wait for finalization; `interrupt` reports timeout instead of claiming a still-finalizing run completed.
- Pending drafts track edit intent separately from their content. Clearing text, attachments, or a Waggle preset must not resurrect an older branch draft when hydration finishes. Keep that intent across composer unmounts and Session switches, consume it on branch adoption, and remove it with the Session's draft cache. Unchanged empty editor synchronization is not an edit.
- Responsive sidebar mode changes must keep the main React subtree mounted. Switching its parent between a sheet fragment and a docked layout destroys Lexical chips, unsent text, selection, and embedded visualization state. Change only the sidebar presentation inside a stable frame. A sheet opened by resizing has no surviving opener; restore focus to the stable main panel when it closes, never to the document body.
- Classic, direct Waggle, and agent-triggered Waggle handoffs share `captureRunResultResources` before reporting completion. Capture the follow-on run's persisted messages and node/branch provenance even when its outcome is aborted or failed; capturing only the classic handoff request leaves the resulting collaboration outputs missing from an already-mounted catalog.
- Chromium long-task entries measure wall time, not renderer CPU time. A hidden Electron renderer on a shared GitHub-hosted Windows VM can be descheduled for several seconds during the roughly 40-second 1 MiB source scenario and report the pause as one long task. That one uncalibrated absolute assertion is therefore disabled only for hosted Windows; the scenario still enforces first paint, skeleton-before-tokenization, bounded DOM/worker/transfer work, completion, and renderer errors. Local, macOS, Linux, diff rendering, and shorter Windows interaction windows retain their absolute long-task budgets.
- Pierre's working pool owns the effective render options. Passing the active Syntax theme only to `<File>` or `<CodeView>` is insufficient: initialize the worker pool and surface with the same revision-specific runtime theme, and call the pool's `setRenderOptions` when a mounted diff changes theme because `WorkerPoolContextProvider` consumes `highlighterOptions` only during its initial state creation.
- Right-sidebar performance checks must target the shared visible panel marker, not the docked shell: narrower or DPI-scaled viewports use the sheet variant, and a docked-only locator reports missing feedback even while highlighted code is visible.
- During timed renderer work, poll visibility or completion values without locator-expect ARIA diagnostics. A hosted Windows CPU profile traced 4.6-second long tasks to Playwright's `_ariaSnapshotForExpect` / `generateAriaTree` while preparation was pending, not OpenWaggle rendering. `expect.poll` with `isVisible()` or `count()` preserves the assertions and existing performance limits without that injected traversal.
- Playwright CSS locators still traverse shadow descendants for `count()` and `isVisible()`. The Windows Full run on `8c1f86af` sampled 500–740 ms in injected CSS queries even after removing ARIA diagnostics. Timed diff probes now use native light-DOM queries and inspect only the first diff container's shadow code, preserving visibility and completion checks. Profiles also contain application rendering/layout work, so probe overhead alone does not establish that the Windows performance failure is fixed; confirm against fresh hosted CI without relaxing budgets.
- Workspace document identity includes the active working-tree root and relative path. The active file, search highlighting, syntax caches, journals, saves, and file mutations must not collide when two worktrees expose the same relative path.
- Focused file edits autosave after 500 ms through serialized, revision-checked main-process writes. `Cmd/Ctrl+S` flushes immediately. A bounded recovery journal protects only the active file until a save succeeds.
- A watcher re-read of the exact saved revision, content, encoding, and line ending must preserve the main-process document-session version. Resetting it makes the next valid edit look stale and surfaces as `Save failed`.
- The bounded main-process document-session cache can evict a file while the renderer still holds a fresh query result. Applying an edit to a missing session must re-read the disk baseline, require the cached revision to match, and restore the renderer's base version before applying its next batch.
- Text files no larger than 1 MiB may enter Focused file edit. Larger files use read-only requests of approximately 256 KiB with no force-full-edit escape hatch. The measured budgets live in `docs/specs/syntax-highlighting-performance.md` and `performance/syntax-budgets/`.
- Imported TextMate grammars execute only in killable workers. Prefer the JavaScript regex engine and load Oniguruma/WASM only when a grammar needs it.
- Recursive VS Code theme includes share one cumulative byte and JSON-value budget per theme chain. Standalone imports reuse the already-parsed root, and each unpacked extension theme declaration owns a separate budget; never reset these limits for each included file.
- Theme selections use stable resource ids while Shiki and Pierre receive revision-specific runtime names. Imports accept familiar VS Code theme JSON/JSONC, TextMate `.tmTheme`, VSIX or unpacked VS Code extensions, and native packages declaratively without executing extension code. Preserve normal and high-contrast variants so future whole-app theming can resolve the same appearance model.
- Syntax resource discovery treats only `ENOENT` as an empty installed or project library; permission and I/O failures must reach the catalog error state. Project resources get separate 8 MiB preflight and actual-read budgets, and actual reads include repeated theme dependencies plus expanded VSIX bytes. Only typed syntax-validation failures may be skipped as malformed. Keep colliding project grammars in the Settings catalog with a visible disabled diagnostic even though only the activatable subset may reach Shiki/Pierre workers.
- Local reference evidence comes from the installed T3 Code and Codex GUI bundles, not the open-source Codex TUI. See `docs/performance/syntax-reference-capture-2026-08-27.md` for versions, hashes, and the architectural findings that informed virtualization, worker count, viewport work, save cadence, and cache identity.
- Appearance packages provide semantic-token and typography defaults; global user preferences are sparse runtime overrides. Reset removes the override so a future whole-app theme can supply its own defaults. Theme catalogs use CSS-only specimens and mount exactly one tabbed live syntax preview to keep Settings responsive.
- Tailwind source discovery must not walk the repository or linked worktree Git metadata during startup. `isolatedTailwindSourcePlugin` writes one renderer-source manifest under the OS temp directory and `source(none)` points Tailwind at that file; this keeps Git worktree indirection and dependency trees off the Vite critical path while preserving hot updates.
- Renderer startup must keep optional editing and appearance work off the shell path. Do not force Vite dependency re-optimization on every launch, lazy-load Settings, and never statically import a syntax worker constructor into the shell path.
- A `lazy(() => import(...))` boundary does not work if the lazily loaded component is also re-exported from a feature root `index.ts` that eager shell code imports for hooks or stores. Rolldown keeps the re-exported module, and everything it imports, in the initial chunk. Until v0.4.0-alpha.9 this put xterm, the terminal panes, and the browser preview panels (about 900 KB) in the initial graph, even though `WorkspaceTerminal`/`WorkspacePanelContent` import them lazily. Export heavy panels from `features/<name>/components/index.ts` only, never from the feature root, and render on-demand surfaces (such as the guided `ActionPanel`) through `lazy()`. The initial-graph budget (4.5 MiB, `scripts/check-syntax-bundle.ts`) used to run only inside `pnpm build`, so PR CI never checked it. v0.4.0-alpha.8 and alpha.9 failed their release builds after merge, leaving tags with no GitHub Release. `pnpm check` now runs `pnpm check:renderer-bundle`, so the required Typecheck & Lint job fails an oversized graph on the PR itself.
- Vite development must pre-optimize `shiki` and `shiki/wasm` and warm the renderer plus syntax-worker entrypoints. A cold first `.ts` open otherwise discovers the WASM dependency in response to the user action, reloads the renderer, and lets the four-second syntax timeout fire repeatedly. The `server.warmup` and `optimizeDeps.include` entries in `electron.vite.config.ts` keep that cost on server startup; the review surface paints a bounded viewport skeleton immediately and tokenizes off-thread before revealing source.

## Product And UX Memory

- The Session Summary is a floating overlay, never a layout column. It must not add transcript or composer padding. The host auto-hides it when the chat container has less than 840px or the right sidebar opens, while the Summary toggle remains available so an explicit open can overlay the chat at any width.
- Pi-native sidebar navigation is Projects-only. Do not add a global projectless Chats section.
- Waggle mode must run inside Pi as extension/runtime behavior, not as an OpenWaggle application loop that calls Pi once per agent turn.
- Waggle currently supports exactly two agents. Third-agent JSON edits must be rejected at core, Pi extension, shared schema, store schema, and application-service boundaries until N-agent turn policy, prompts, consensus, and UI are implemented first-class.
- Waggle and standard mode share session, branch, draft, archive, transcript, active-run, composer, settings, diff, and git semantics unless Pi imposes a narrow technical constraint.
- Composer branch/config changes are branch-scoped; child branches inherit parent config by default.
- Before changing composer draft ownership, flush pending Lexical updates with `editor.read()` and then read the composer store. Lexical batches edits, so a workspace hydration or session switch can otherwise snapshot stale store text and overwrite the newest edit. Regression coverage must use a real editor with an update pending during hydration, clearing, and session switching, not just direct store writes.
- Native resize tests must establish their input precondition and await the renderer's responsive state, not just `BrowserWindow.setContentSize()`, which returns before ResizeObserver runs. Hidden iframe pointer delivery can miss on macOS as well as Linux/Windows: non-privileged tab tests use delegated DOM clicks while host follow-ups retain trusted keyboard activation. CI preserves Playwright reports even when retries make the job green.
- Session-selection E2E readiness must match the mounted route surface's Session ID to the selected sidebar row, not just the header title and composer visibility. Sidebar selection updates the store before routing commits, so the outgoing surface can briefly show the new title/transcript before its lazy route replacement. Workspace hydration remains an independent boundary and must not be awaited by the shared navigation helper (delayed-hydration tests intentionally hold it).
- Manual compaction mirrors Pi TUI slash-command UX: `/compact` and `/compact <custom instructions>`, not context-meter-triggered compaction. The `/` chooser lists the GUI-only built-ins (`/compact`, `/fork`, `/clone`) first, matched by command name; Enter submits a built-in only when it is the whole draft, otherwise Enter/Tab/click completes it. Without that, a skill whose description merely mentioned "compact" captured Enter and manual compaction was unreachable.
- Provider auth UI is method-based. Keep provider-level availability separate from API-key configured state and OAuth connected state.
- Compact composer interactions stay in-row unless the maintainer explicitly asks for a larger workflow.
- Responsive composer toolbars reserve a non-shrinking primary-action group for voice, stop, and send. Secondary controls compact at the composer container boundary; they must never push the send action outside the composer.
- Worktree birth is an app-owned launch lifecycle before Pi starts. Show the full creation card while any launch step runs, then persist a compact expandable `Worktree created` custom event in the transcript. Local launches show a live step card too but leave no creation trace; cancelled births leave none either.
- Everything a first send waits on before `agent_start` is a labelled launch step (`WorktreeLaunchProgress.label`): pull the base from origin, create the worktree, run Setup (only when a Setup definition will run), pull the local branch (only when it has an upstream), connect MCP servers that expose direct tools (only while the turn actually waits for one; see MCP Runtime Memory). A measured local first send spent 4.7s in `git pull` and 10.4s connecting four MCP servers with nothing on screen. Steps are sequential by default; `parallel` steps (local pull and MCP) stay open until their own `completesStep`, because they now run concurrently. Report steps only on a Session's first run or when a later run really prepares its worktree: an existing recorded worktree reported "recovered" on every turn and flashed a launch card and a Connecting status.
- The composer owns environment and ref as separate controls before the first turn. First send freezes the launch plan and collapses that setup dock; worktree creation leaves its compact trace in the transcript. The plus menu routes to existing attachment, project-file, skill, and Waggle flows rather than duplicating their state.
- User-facing filesystem paths are relative to the active Session working root or project root. Canonical absolute `WorkingPath` and `RepositoryPath` values stay internal for IPC, filesystem operations, and copy actions; first-party UI must never expose OpenWaggle's worktree storage prefix.
- Sidebar session rows are two lines at 316px width: the title owns line one, line two carries a shrinkable lead (state, phase, provenance) and a fixed tail (shortcut, timestamp). The timestamp never hides on hover; row actions overlay line one instead, because hiding it re-flowed the row under the cursor and removed information at the moment of acting on it.
- Status colour is a semantic role, never a palette class or a status-prefixed token (ADR 0021). Adding a state means naming a role, not reaching for `text-red-500`.
- The sidebar's `@theme` block must stay `@theme static`. Tailwind tree-shakes theme variables no utility references, and roles read at runtime through `var()` in inline styles (`--color-neutral`, `--color-review`, `--color-plan`) silently vanish otherwise.
- Do not show a count of uncommitted files on a session row. Every session sharing a working tree reports the same number, so it says nothing about the session, and a large number implies a severity it does not carry. Divergence (`↑n ↓n`) is the useful part.
- Provenance icons are a separate family from status icons and share no glyph with them (ADR 0020). At the size line two renders, a user reads silhouette rather than detail, so two node-graph glyphs are the same glyph.
- Sidebar view preferences (session sort, collapsed projects) persist; sidebar filters (state chip, text query) do not. A filter that subtracts sessions must not outlive the intent behind it.
- `useSessionGitIndicators` keys refreshes by the semantic working-path set. Freshly filtered Session arrays must not restart its effect; route-level Git effects likewise use resolved path values instead of Session DTO identity.

## Access Modes And Authorization Memory

- Authorization mode is a live chain resolved when a request is raised, not a value copied at session
  creation (ADR 0023). `authorization_mode_override` is nullable and `NULL` means inherit. Never read
  absence as `yolo`: that pins every pre-existing session to full access and makes the user's global
  default permanently irrelevant to it.
- Session creation stores no mode. If a create path needs one, the design is wrong; resolve at the
  point of use instead.
- Request purpose is declared at the call site. Never infer it from a title, and never re-introduce
  the exact-match title sniffing that used to live in `interaction-ui-context.ts`: renaming a title
  silently changed what full access could answer and no check could see it.
- Anything reaching `ui.confirm` is a question addressed to the user and can never be auto-answered.
  Authorization has its own entry point, and a missing channel degrades to prompting.
- Of the seven confirmation points in the app, exactly two are authorization. Opening an external URL
  and the input disclosure are not, and auto-granting the disclosure saves no work because the editor
  after it still blocks.
- Full access must emit no event at all, not merely skip the prompt. The "no transcript entry, no
  counter, no log" guarantee is enforced by short-circuiting before emission.
- Grants are keyed on requester, capability and resource, and are stored in project config, following
  Codex. Arguments are excluded, and an absent resource is never a wildcard: server-level matching
  would let a server widen its own permissions by shipping a new tool.
- An arriving request adds a surface above the composer and changes nothing about it. Do not disable
  the composer, move focus, or change the placeholder, and do not bind Enter to answering a request.
  T3 Code does seize the composer; we deliberately do not.
- Notification lifetimes count window-focused time and pause on blur, following T3. A timer keyed to
  the notification array instead of to each notification id restarts every clock on every new event,
  so nothing ever expires during a busy run.
- Notifications and decisions need independent event budgets. One shared window let informational
  notices evict an authorization request and its resolution, leaving a transcript row stuck on
  "Waiting" after the decision was made.
- The notification durability rule is shared between main and renderer. Two copies drift into a
  transcript that disagrees with itself after a reload while both sides' tests stay green.
- Migration 24 is `pinned-sessions` and had already shipped. Never renumber or replace a migration id
  that users have applied.
- Rebuilding the `sessions` table is not safe: it is the parent of cascading foreign keys, and a
  rebuild under `PRAGMA foreign_keys = ON` deletes every node and pinned row with it. Add a column.
- A dev-only route must inline `import.meta.env.DEV` at the `lazy()` call. Importing the flag as a
  constant from another module leaves the dynamic import reachable and ships the chunk.
- Guard visible strings with a source scan, not `queryByText('some-id')`. Exact-match queries stay
  green when an identifier is appended to a label, which is how `pi-tui-custom` survived its own test.
  A source scan is only worth its name if it recurses and includes `.ts`: the first version walked two
  directories non-recursively with a `.tsx` filter, so it could not see nested components, other
  features, or the label maps in plain modules, and it reported green while user-facing copy named the
  runtime. Prove such a guard fails by injecting a leak before trusting it.
- An Effect Schema `Struct` DELETES keys it does not declare, and a union annotated
  `Schema.Schema<SomeUnion>` makes that invisible to the compiler when the field is optional. A field
  added to a response type but not to its schema is silently dropped at the IPC boundary. This is how
  the approval scope was lost with the whole scoped-grant feature inert and every unit test green:
  the tests answered the broker directly and never crossed the schema. Any response field needs a
  decode test through the real schema.
- The run cwd is not the project. `ensureSessionWorktreeProjectPath` returns the worktree for a
  worktree session, so anything durable keyed on it lands somewhere the rest of the app never looks:
  grants written there could not be listed or revoked in Settings. Pass the durable project root
  explicitly and name the field so the cwd cannot be handed over by accident.
- A lenient config read is wrong for a permission decision. `loadProjectConfig` logs and returns empty
  on an invalid file, and empty falls through to the global default, which ships as full access, so one
  bad field silently stopped a project from asking. Use a strict read where the answer is a permission
  and fail closed.
- `aria-live` on a conditionally mounted element announces nothing. A polite region must already be in
  the accessibility tree before its content changes, so an always-mounted, initially empty announcer is
  required. Asserting the attribute is precisely the test that stays green while nothing is ever
  spoken.
- Disabling the focused element blurs it. A busy flag that disables every control in a surface moves
  focus to `<body>`, so Escape handlers on that surface stop firing and the next Tab restarts from the
  top of the document. Return focus explicitly when the action settles.
- Project config writes are read-modify-write. Without per-path serialization two concurrent writes
  both read the pre-change file and the second rename wins, so one grant is lost while the UI reports
  both as saved. A run can raise several authorization requests at once, so this is reachable.
- SQLite has no `ADD COLUMN IF NOT EXISTS`, and the migration ledger only guards the same id. A column
  that exists under a different id fails the `ALTER` and takes boot with it, which is reachable
  whenever a migration is renumbered. Guard the column, not just the id.
- Do not rely on the browser repainting `<option>` text before a native select popup opens. The popup
  is drawn outside the DOM, so neither jsdom nor Playwright can observe what it shows, and a lost race
  can render two options with identical text. Use one label vocabulary instead.
- The selected model is app-DB state, never repo state. `.openwaggle/settings.json` lives inside the
  user's repository, so a personal model pick committed there leaks machine-specific provider config;
  it is stored as `selectedModelsByProject` in the SQLite `settings_store` instead, and the project
  file writer strips any legacy `preferences.model` on write. `authorizationMode` stays repo-local by
  design; `thinkingLevel` is never a project preference (it is Session state, see below).
- A Session's model lives in its execution profile (`session_execution_profiles.profile_json` `$.modelId`)
  and changes only through the Host-owned `sessions:set-model` channel, which refuses
  (`session_run_active`) while a Run is starting, active, or stopping. Classic and Waggle Runs read it
  once at Run start, so a switch reaches only the next Run, including queued follow-ups. The
  renderer records each Run's model from `agent_start.model` (`runModelBySessionId`) to explain the pending
  pick above the composer and keep the context meter on the running model. That map survives an
  `agent_end` with `willRetry` (the Run continues on the same model through the auto-retry wait) and is
  cleared on a terminal `agent_end`, a failed or cancelled `auto_retry_end`, or run completion. Sends and enqueues await
  `settledSessionModelWrites` first, because the Host, not the send payload, picks the model. A Session
  pick never rewrites the project's preferred model for new Sessions.
- The Session thinking level follows the model (ADR 0044 notes): `$.thinkingLevel` in the execution
  profile, set through `sessions:set-thinking-level`, read and clamped at Run start, and recorded by Pi
  as `thinking_level_change`. Messages, queued Follow-ups, and `AgentSendPayload` carry no thinking
  level, and Follow-ups carry no Run authorization override. `SqliteSessionSettingsRepository`
  checks the active Run in the same transaction as the write, so a model or thinking change is
  refused (`session_run_active`) while a Run is starting, active, or stopping, but allowed while
  the queue waits. A `message`/`start` level is written with the Run's admission
  (`persistRunStartThinkingLevel`, same transaction as the starting Run). A desktop pick also
  persists Pi's global default and publishes the sessionless `default-thinking-level-changed` Host
  event; a caller's `thinking` on create/launch/spawn or an idle-start `message`/`start` never does,
  and extensions cannot set it (the broker refuses `thinkingLevel` in settings patches). A new
  Session starts from Pi's *global* `defaultThinkingLevel`: a project-level Pi default is never
  read, so a draft pick always sticks. Renderer: `useSessionThinkingLevel(sessionId)` returns
  `{ level, setLevel, canChange }` (a draft, `null`, reads/writes Pi's default). First send
  creates the Session at the level the draft shows (`draftThinkingLevel`: pending pick, else the
  default query) through the 4th `sessions:create` argument, sent as
  `specialization.thinkingLevel`, which never writes Pi's default; there is no module-global
  draft pick to go stale. First send locks the draft (`lockDraftForFirstSend`, `isMaterializing`)
  before its first await and reads the level only after `settledThinkingLevelWrites`, from the
  query cache (`readDefaultThinkingLevel`). A 4-argument `sessions:create` needs revision 21
  (`HOST_UI_REVISION_21_ARGUMENT_COUNTS` in `requiredHostUiRevision`). `useSessionSettingsChangeable(sessionId)` is the shared picker gate:
  false while a Run starts (first send from the moment `createSession` resolves, foreground send,
  worktree launch, or a queue action whose outcome was `started-run`, kept in
  `queued-run-start-store` until that Run's `agent_start`/settlement, or until a Host resync
  re-reads the Session's queue as idle: `reconcileQueuedRunStarts`), while the queue snapshot
  reports `activeRunId` (Runs started anywhere: CLI, other windows, agents), runs, or finishes
  (terminal `agent_end` or a failed `auto_retry_end` until the final `run-completed`). Sends,
  enqueues, draft creates, and every queue change that can start a Run (resume, `queue-adopt`,
  edit save/cancel, withdrawing a running queue's head) await `settledSessionSettingWrites` inside
  `withForegroundSend` (`mutateMayStartRun`). Locked pickers use `aria-disabled` plus an
  `aria-describedby` reason and take focus back from a list or menu the lock closes.
- Every Host Session already had `$.thinkingLevel` in its execution profile before revision 21
  (written at creation or cutover, and required by `decodeSessionExecutionProfile`), but beta.5 Runs
  used the message's level, so that stored value was stale. Pi's entries hold what each Session last
  ran with. `migrateLegacyThinkingLevels` (`adapters/sqlite-legacy-thinking-level-migration.ts`)
  runs first in `startHostBackgroundServices`, before the Host listens: (1) beta.5's desktop pick
  `settings_store.thinkingLevel` becomes Pi's global default if valid and Pi names none
  (`ThinkingLevelDefaultService.getConfiguredDefault`, unlike `getDefault` which falls back);
  (2) once, gated by the `sessionThinkingLevelsRestored` settings_store marker, every profile's
  level becomes the last projected `thinking_level_change` on its active path
  (`last_active_node_id`, else the newest node, where Pi opens the file), else its stored level,
  else Pi's default. Pi records a level after clamping it to the model, so a restored `off` gives
  way to a higher legacy level (the desktop pick, else the stored level; a desktop pick of `off`
  keeps `off`), and the pick survives a later switch to a reasoning model (`sessionLevel`); (3) the
  desktop pick key is deleted only after both succeeded. Pi restores exactly that
  entry when no level is passed (`sdk.js` `hasThinkingEntry`), but every Run now passes the stored
  level, so without the backfill a Session would silently switch levels on its first Run after the
  upgrade. It is not a ledger migration on purpose: a new migration id raises
  `SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID` and fences older binaries out of the database.
  Failures are logged and retried at the next Host start.
- `sessions:set-thinking-level` publishes `session-list-changed` as soon as the Session write
  commits, then writes Pi's default; a failed default write is logged and never reported as a failed
  Session change (`default-thinking-level-changed` is published only on success).
- `withCallerCeiling` (`application/session-control-run-authorization.ts`) clamps a starting Run's
  override to the caller's ask-for-approval ceiling only when the Run's `intent.callerId` is that
  caller: its own message, or its own Follow-up that its resume delivers. Resuming in front of
  someone else's Follow-up leaves it alone; that Run is bounded by its writer's boundary
  (`session-agent-run-ceiling.ts`) when it starts.

## Tooling Memory

- The detached Session Host (ADR 0030) runs agents with its console on `/dev/null`; it writes `openwaggle-host-YYYY-MM-DD.log` beside the GUI log (ADR 0037). Look there for run and persistence failures, not in the GUI log. Tagged Effect errors such as `SessionProjectionRepositoryError` have an empty `message`; format them with `describeError`, which follows `cause` through `FiberFailure`.
- Seeded QA sessions written straight to SQLite have no Pi session file. A run in one persists Pi's snapshot, which does not contain the seeded nodes and replaces them. Seed fresh fixtures for each run that sends a message, or use app-created Sessions.

- Package manager: `pnpm`.
- macOS release signing (ADR 0040, `scripts/mac-signing.ts`): never throw from `electron-builder.ts` — `postinstall` runs `electron-builder install-app-deps`, which loads the config, and the nightly canary builds `stable` without secrets; the RC/Stable signing requirement lives in a `release.yml` step instead. electron-builder before 26.16.1 cannot sign through `CSC_LINK` because `set-key-partition-list` receives the `.p12` password instead of the temporary keychain password (upstream #10066/#10172). 26.17.0 also switched macOS zips back from native `zip` to 7za with `-snl`: zips are about 2% smaller and framework symlinks survive, but each zip takes about 40 s longer. A local `CSC_LINK` build leaves `~/Library/Caches/electron-builder/electron-builder-root-certs.keychain` in the user keychain search list; restore it with `security list-keychains -d user -s ~/Library/Keychains/login.keychain-db`. On the maintainer Mac, Gatekeeper assessment is disabled (`spctl` reports `override=security disabled`), so local `spctl` passes prove nothing; notarization is proven only by `stapler validate`. The Developer ID key, CSR, and `finish.sh` that turns a `.cer` into the release secrets live in `~/.openwaggle-signing/`, outside the repository.
- Differential updates: GitHub release asset downloads answer single `Range` requests with 206 but multi-range requests with HTTP 501. electron-updater's `generic` provider enables multi-range for every URL except `s3.amazonaws.com`, so `src/main/update-feed.ts` must pass `useMultipleRangeRequest: false` or every differential download silently falls back to a full one. Before ADR 0040 the release workflow published no `.blockmap` files at all. To measure a plan offline, run `computeOperations` from `electron-updater/out/differentialDownloader/downloadPlanBuilder` on two gunzipped blockmaps.
- Release branch synchronization must use fetched Git ancestry, not only GitHub's `mergeStateStatus == BEHIND`: `UNKNOWN` or `BLOCKED` can conceal a stale branch immediately after a main push. Validate a stale candidate's version-only change against its unique merge base before syncing, then validate against pinned current main and recheck ancestry after CI. Otherwise legitimate main manifest changes fail the release guard before synchronization.
- GitHub can return a generic GraphQL error from `gh pr create` after a release branch has already been pushed. Release preparation must retry the mutation and re-query the exact same-repository release branch after every failure so it can adopt an ambiguously created PR instead of stranding the release or creating conflicting state.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are the target strictness posture, but enabling them in build or lint tsconfigs requires a dedicated source-modeling pass across the active Pi/session refactor; lint-only enablement can create TypeScript `error` types that surface as noisy Oxlint `typescript/no-unsafe-*` diagnostics.
- TypeScript 7 uses Oxlint with tsgolint for type-aware TypeScript rules. ESLint remains for repository-specific, TanStack, and import-cycle rules; transitive `@typescript-eslint/*` utilities come from those third-party plugins and are not OpenWaggle's TypeScript parser.
- Unit, integration, and component tests belong in nearby `__tests__/`. There is no E2E suite (ADR 0033).
- Releases publish a `.blockmap` beside each installer, and its name extends the installer's (`…-arm64.dmg.blockmap`). `scripts/install.sh` looked up the checksum with `grep "$FILENAME"`, got two hashes, and failed every 1.0.0-beta install with a "Checksum mismatch" that printed the correct hash. Its asset regex was also unanchored. Any lookup by artifact name must match the whole name. The installer bundled in an app (`openwaggle update`) carries the bug until the next release ships the fix.
- The first signed release (`1.0.0-beta.1`, run 36695614844) failed because the GitHub macOS runner lost its network while notarytool polled Apple (`HTTPError(statusCode: nil)` / `NSURLErrorDomain -1009`, after the upload and after x64 had notarized). It was not a signing or credentials problem. The release workflow rebuilds macOS for the runner failures that `scripts/macos-build-failure.ts` classifies as transient. Rerunning the failed jobs of a release run is safe, because the version job (which has already pushed the tag, idempotently) is reused and nothing is published until `Create GitHub Release`.
- `1.0.0-beta.8` (run 37285929256) also failed on the runner, on all three attempts. Both apps notarized, then dmgbuild failed with `hdiutil: create failed - Device not configured` (once `attach failed`). hdiutil is a known flake on hosted macOS runners under concurrent disk I/O (actions/runner-images#7522). `patches/dmg-builder@26.17.0.patch` now retries only the failed `dmgbuild` call, with its wait outside electron-builder's toolset lock so the other arch's DMG is not starved. The whole-build retry (three attempts, Spotlight off, XProtect stopped) is the backstop. Its classifier only accepts an hdiutil error inside the failing dmgbuild report, so recovered warnings do not trigger rebuilds. A rerun of a release run uses the workflow at the release commit, so a workflow fix only applies from the next release.
- To verify the dmgbuild retry locally, point `CUSTOM_DMGBUILD_PATH` at a shim that fails once with the hdiutil message and then execs the cached real `dmgbuild` (`~/Library/Caches/electron-builder/dmg-builder@*/dmgbuild-bundle-*/dmgbuild`). `scripts/__tests__/macos-build-failure.integration.test.ts` covers the patched helper with a shim and a private toolset lock.
- A test that spawns many real child processes is an integration test (`*.integration.test.ts`), not a unit test. The protected profile-credential store runs every owned-file read/write/list/unlink in a fresh `node -e` helper, so one staging test spawns 20–300 processes. Under the full parallel unit suite on a busy Mac each spawn slowed from ~90 ms to 1–5 s, and those tests became the only recurring pre-push timeouts. Raising `testTimeout` again would not have fixed this. The eight spawn-heavy files now live in the integration tier, which CI still runs on every PR; the unit tier keeps the files that spawn only a handful of processes.
- Do not suppress Fallow complexity findings; refactor instead.
- Do not add legacy compatibility for removed pre-Pi surfaces unless explicitly requested.
- Node 24 Vitest workers abort in better-sqlite3@12.11.1 teardown (`Statement::~Statement()` → `RemoveEnvironmentCleanupHook`). `@effect/sql-sqlite-node` pulls v12 while the app uses v13; keep the workspace override that makes Effect reuse v13.0.1. This removes the duplicate native addon and lets the full parallel unit suite finish.
- Dependency-update trap: `packages/*/dist` is gitignored but consumed by root typecheck. A stale dist built mid-bisection caused 185 phantom type errors (`AnyNoContext`/`TypeId` mismatches that looked like effect/typebox breakage). After changing any dependency version, run `pnpm build:package-dependencies` before trusting typecheck results.
- Root `undici` is 8.x. `secure-fetch.ts` must wrap each DNS-pinned `Agent` in Undici's `Dispatcher1Wrapper` before passing it to Node's **global** fetch, whose bundled Undici uses the legacy dispatcher protocol. Keep `allowH2: false` on those Agents to preserve HTTP/1.1 behavior. The `@earendil-works/pi-coding-agent>undici` override remains independent.
- TanStack internal overrides (`@tanstack/history`, `router-core`, `router-generator`, `router-utils`) must move in lockstep with `@tanstack/react-router`; a pinned older `router-core` breaks at runtime with `SyntaxError: ... does not provide an export named 'getUrlScheme'` in unit suites, not at typecheck time.
- `scripts/package-release-validator.ts` pins `release-please` to an exact version for deterministic preflight contracts; a dependency sweep must not bump it (the unit test catches it).
- TanStack Query ≥5.102: `queryClient.query()` applies `select`, while the deprecated `fetchQuery` did not — a mechanical `fetchQuery`→`query` migration changes what test assertions receive (selected vs raw queryFn data).

### `fromPartial` hides fixture mismatches as well as expressing them

`fromPartial` from `@total-typescript/shoehorn` casts. Wrapping a whole test fixture in it
makes type errors disappear whether the partiality was intended or not: a field with an
outright wrong type (`switchToLocalMode: 'not-a-function'` where `() => void` is required)
compiled silently once the object was wrapped. Verified while building the renderer test
type guard — the guard passed with the broken fixture until the wrapper was removed.

Use it only where a large type is deliberately stubbed and the test asserts on a subset.
When a fixture is *meant* to be complete, keep it unwrapped so a missing or wrong field
is reported. Two of this repository's own fixtures were failing for exactly that reason:
required fields had been added to `SessionContextRowState` and never added to the fixtures.

### A count-based ratchet is defeated by swapping one error for another

The first version of `scripts/check-renderer-test-types.ts` compared per-file error counts
against a baseline. A deliberately broken mock in a file that already had errors kept the
total identical and passed. The check is binary per file instead: files not on
`scripts/renderer-test-type-exemptions.json` must have zero errors, and an exempt file
that becomes clean fails as a stale exemption so the list can only shrink.

### The React Compiler now runs in component tests

`vitest.component.config.ts` applies `reactCompilerPreset()` via `@rolldown/plugin-babel`,
matching `electron.vite.config.ts`. Before this, component tests exercised un-compiled
output while the app shipped compiled output, so the suite was structurally blind to
compiler-interaction defects.

Proof it now bites: deleting the scoped `'use no memo'` from `FileTree.tsx` — the directive
that fixed a navigator rendering zero rows in the app while tests passed — fails 5 tests.
Before the change, removing it failed none.

The unit config runs in `environment: 'node'` and renders nothing, so it needs no compiler.

### Two exported types with the same name in sibling modules is a live trap here

`store/sessions/types.ts` and `store/session-details/types.ts` both export
`SessionSummaryRow` with different shapes, and each module had its own
`hydrateSessionSummary`. A change meant for the session list was made to the detail-side
function: it typechecked, its own test passed, and the feature was simply absent until the
app was opened. The detail-side function is now `hydrateSessionDetailSummary`.

`pnpm check:repository-standards` fails on any *new* duplicate exported type name under
`src/`, against a checked-in `KNOWN_DUPLICATE_EXPORTED_TYPES` list that can only shrink
(resolving one without removing it from the list also fails). `packages/extension-sdk`
deliberately mirrors shared types as its public surface, so the check is scoped to `src/`.

Rules considered and rejected as noise: duplicate *declared* function names (241 existing)
and duplicate *exported* function names (14). Only the type-name variant was both low-noise
and pointed at the actual trap. Note the function I edited was not exported at all, so an
export-only rule would never have caught it — the durable catch for that half is the
integration test on the live `listSessions` path.

### SELECT column lists are invisible to the type checker

`sql<SessionSummaryRow>` asserts the row shape; it does not verify the query selects those
columns. Three queries typed that way omitted `environment_mode` and `worktree_path`, so
every session in the list reported local mode with no worktree and the per-session git
indicators were absent. Typecheck, lint and the whole suite stayed green; it was found by
opening the app.

The columns now come from `SESSION_SUMMARY_COLUMN_NAMES` in `store/sessions/types.ts`,
interpolated as a fragment by `sessionSummaryColumns(sql)`. Three layers keep it closed:
the shared fragment, a repository-standards rule rejecting an inline column list in a
`sql<SessionSummaryRow>` query, and `store/__tests__/session-summary-columns.integration.test.ts`
which drives the real SQLite path. The detail-side `session-queries.ts` is exempted by name:
its `SessionSummaryRow` is a different type with `message_count` and table aliases.

Note the detail worth remembering: dropping a column fails the integration test but produces
**zero** typecheck errors. Types cannot see into a SQL string.

### Working-tree vs repository paths are branded (WorkingPath / RepositoryPath)

`src/shared/types/brand.ts` defines `WorkingPath` and `RepositoryPath`. Working-tree reads
and mutations (`getGitStatus`, `commitGit`, `getGitDiff`, `stageAllGitChanges`,
`revertAllGitChanges`, vcs-status, stacked actions, branch checkout/create) take a
`WorkingPath`; repository-level lists (branches, worktrees) take a `RepositoryPath`. Both
are erased strings at runtime, so IPC serialization is unaffected.

`resolveSessionWorkingDir` is the ONLY producer of a `WorkingPath` (in local mode it
rebrands the checkout — same string, correct role); `useRepositoryPath` produces the
`RepositoryPath`. So a working-tree mutation can only be fed from the session→tree rule,
and passing a repository/project path to one is a compile error. `git-path-brands.unit.test.ts`
pins this with `@ts-expect-error` on every wrong pairing — if a brand stops being enforced
the directive goes unused and the typecheck fails.

Branch checkout/create take BOTH a WorkingPath (git runs in a tree) and a RepositoryPath
(whose branch list to refresh) — equal only in local mode, which is the only place checkout
is reachable. The store's `checkoutBranch`/`createBranch` were previously handed one path
named `workingPath` and used it for both; the branding surfaced that conflation.

### The renderer test type exemption list is empty; keep it that way

`scripts/renderer-test-type-exemptions.json` is `[]`. Every renderer test file typechecks
under `tsconfig.renderer-tests.json`, enforced by `pnpm typecheck:tests` (part of
`pnpm check`), which is binary per file: any test file with a type error fails. The
dominant fix while clearing the original 330 was annotating fixture factory return types
(`ChatTextPart`, `UIMessage`, `SessionNode`, `MessageChatRow`, `ChatPanelSections`, etc.)
so a literal like `type: 'text'` or `role: 'assistant'` is checked against the interface
instead of widening to `string`. Do NOT use `fromPartial` to silence a whole-object
mismatch — it casts and hides real errors.

### A measuring instrument that reads innerText measures itself

A probe that polled `log.innerText` every 8ms to detect a rendered transcript reported roughly 1,000ms for every session switch, suspiciously constant. `innerText` forces synchronous layout, so on a 50,000px subtree the poll loop was the cost being reported. A `MutationObserver` on the same element put the real figure at 221-267ms.

Two symptoms mark this mistake: a number that barely varies across different inputs, and a blocked-time total that does not add up to the wall clock. When the timings look suspiciously flat, suspect the instrument before the application. Use `MutationObserver`, `PerformanceObserver` or a CDP trace, none of which read layout.

### A row is only as clickable as its handler is wide

The two-line sidebar rows put the click handler on the title text inside a 316x48 row, which left 70% of every row dead to clicks. It read as broken navigation rather than as a small target: clicks did nothing, so people clicked repeatedly.

Measure a hit area instead of assuming it. Sampling `document.elementFromPoint` across a row's bounding box, then reporting which control each point resolves to, turns "feels wrong" into "140 of 200 points hit nothing" and afterwards into "3 of 200". The fix is the stretched-link pattern, `after:absolute after:inset-0` on the existing control, with real controls lifted to `relative z-10`.

jsdom has no hit testing, so a component test passes whether or not the fix is present. This class of bug can only be guarded end to end, with a click at a coordinate.

### Electron E2E launches ignore a running dev app, but a dirty tree blocks checkouts

`OpenWaggleApp.launch` sets `OPENWAGGLE_DISABLE_SINGLE_INSTANCE=1`, so a running `pnpm dev` instance does not steal E2E launches. Two things do bite:

`npx playwright test` does not build, and OpenWaggle no longer has a Playwright E2E suite (ADR 0033). `out/build-meta.json` still records the HEAD a build came from, and `scripts/record-build-meta.ts --verify` refuses a stale build (run `pnpm build` first) — relevant for packaged-app QA via `pnpm dev:debug` / `pnpm packaged-app:smoke`.

`git worktree` operations can leave worktree backlinks dangling after nested git-fixture tests run; `git worktree repair <path>` from the main checkout fixes them. Git hooks export `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, so hook scripts that invoke the test suite must unset those first or git-spawning fixtures fail with "this operation must be run in a work tree".

CDP becoming reachable does not mean Electron has created its renderer page. Packaged restart QA can
connect to the browser endpoint while `contexts().flatMap(...pages())` is still empty; poll for the
`openwaggle://` page before asserting UI state or the same healthy restart will fail intermittently.

The dev server rewrites `src/renderer/src/routeTree.gen.ts` (import ordering only, no route change). Any script that checks out commits in sequence fails on every checkout while that file is dirty. Stop the dev server before such a loop.

### Focus draws nothing, by decision

`:focus` and `:focus-visible` set `outline: none` and `box-shadow: none` app-wide, and no component adds a ring, glow or shadow on focus. This is a maintainer decision, not an oversight: do not reintroduce a focus indicator as a fix for a lint rule, an audit finding or an accessibility report. The trade-off is recorded in `docs/reviews/sidebar-remodel-review.md`, including that the app does not meet WCAG 2.2 SC 2.4.7 as a result.

`focus:opacity-100` is not an indicator and stays: it reveals hover-only controls so the keyboard can reach them at all.

### A focused row keeps its focus, so a later keypress paints its focus ring

Clicking a sidebar row leaves it focused. Chromium re-evaluates `:focus-visible` on the currently focused element when the interaction modality changes, so the next key press of any kind paints the keyboard focus indicator on a row the user clicked minutes earlier. Pressing the screenshot shortcut is enough to make it appear in the screenshot.

The consequence that outlives the ring: anything hidden behind `group-focus-within:*` on a row stays hidden for as long as that row holds focus, not just while the pointer is over it. A roll-up pip hidden that way vanished on click and stayed gone.

### Startup compatibility needs persisted-profile tests

Startup compatibility checks must exercise the complete SQLite-to-settings path with maps from older releases. A literal-key Effect `Schema.Record` requires every current command, so fill missing shortcut keys before strict persisted-settings validation; do not replace present malformed values. Zustand terminal layout version 2 also needs a `migrate` callback, otherwise it skips the existing merge decoder for version-1 layouts and logs an error while discarding their tabs. Both paths now have actual-store hydration regressions.

New settings must join `CURRENT_SETTINGS_KEYS` as well as the shared update schema, snapshot builder, and persistence plan. The global compaction threshold follows the same fail-closed saved-data contract: absence uses 80 percent, but a present invalid value remains untouched and blocks settings reads.

Linux terminal integration and E2E jobs explicitly install zsh. Shell-specific PTY tests assert the selected shell because the production fallback chain can otherwise exercise Bash while a test claims to cover zsh startup files. CI step changes also need the exact step contract and workflow AST hash updated without weakening the existing required gates.

GitHub's Linux runner completion directories can fail `compaudit`, leaving interactive zsh blocked on a trust question. Repair ownership/write permissions only on audited paths in disposable CI runners, then require a clean audit. Do not bypass the user's completion security check in production.

Electron native-addon probes load the addon in Electron but pass the invoking console Node executable for the PTY child. On Windows, an Electron RunAsNode child reached JavaScript with neither stdin nor stdout attached as a TTY, producing no ConPTY output. The console child preserves the identity, I/O, containment, drain, and final-output assertions across all three Windows backends.

Browser owner registrations are leases, not navigation history. Release idle owners before allocating the next binding; retain owners with previews, pending materialization, or active agent runs. Serialize unregister/register so a rapid A→B→A navigation cannot unregister the new A binding, and publish selected-preview intent only after registration succeeds. A real-Electron regression visits 70 sessions without reloading the renderer or exhausting the 64-owner limit.

Hidden Linux compositor timing is separate from background timer throttling. Even with `getBackgroundThrottling() === false`, the full app produced roughly 1,016 ms animation-frame intervals under Xvfb. A native presentation subscription restored roughly 16 ms frames, including after idle. Terminal performance QA owns and disposes that subscription; it never replaces animation callbacks, reveals a window, or relaxes budgets. Fit the initial xterm viewport synchronously after `open()` so its first paint is correctly sized; retain the two-frame geometry gate before PTY spawn.

xterm checks its 12 ms parser budget between writes, not inside one write. Sending an entire 128 KiB delivery event or attach history can exceed the 50 ms renderer gate on a slower CPU. Slice writes into at most 4,096 UTF-16 code units without splitting surrogate pairs, and attach the event ACK only to the final slice. A real-Electron 4× CPU-throttled flood reproduced a 70 ms long task before this change and passed three times afterward with no long-task entries. Keep IPC byte offsets, generation filtering, and backpressure unchanged.

xterm's synchronous `reset()` does not discard its queued writes. During clear/restart, old bytes can repaint the cleared viewport or leave a partial escape sequence ahead of replacement output. Queue RIS (`ESC c`) through the same writer before replacement data instead. Tests use real xterm with 10,000 queued old lines and incomplete CSI, OSC, and DCS sequences to verify only replacement content survives.

Performance probes must not subtract independent process wall clocks. Hosted macOS produced negative renderer-keydown-to-main-write samples. Sample the renderer's monotonic clock again after the real main handler returns `written`; the extra return trip is a conservative upper bound under the same 16 ms budget. Native PTY prompt probes must send carriage return for Enter, because Windows console line input does not submit on LF. PTY test fixtures must await both latched process exit and resource drain before removing temporary HOME directories, or Bash can recreate history during recursive removal.

The same Enter rule applies to direct preload `writeTerminal` calls in Electron E2E. A replacement-shell usability probe that appends LF can successfully write bytes on Windows without submitting its command. Preserve the real restart, generation, offset, and marker assertions; send CR as xterm does for Enter.

Closed responsive sidebars keep their content mounted for transitions and state retention. Pair `inert` with `aria-hidden` on the closed container so accessible-role queries and assistive navigation cannot expose offscreen controls. Exercise both docked and sheet breakpoints explicitly instead of relying on the runner's native viewport.

Composer draft hydration must finish before editing or sending becomes available. The selected Session can render before its workspace arrives; restoring a blank scoped draft later erases newly typed slash commands. Existing Session draft keys must use that workspace's project path, not separately hydrated global project settings, or a second context switch can erase input after the first restore. New-session drafts still use the selected project.

Source-view syntax requests must not tokenize an entire 1 MiB file before returning its first 60 visible lines. Retain the source and a resumable Shiki grammar-state prefix in the worker, extend only through the requested end line, and return cached earlier ranges without re-tokenizing. Reapply the cache byte cap as prefixes grow, accounting for retained UTF-16 source and tokens. Real-Shiki differential tests cover multiline grammar state, LF/CRLF, empty/trailing lines, Unicode, and eviction. The Windows loading timeout implicated whole-file work, but that platform's exact failure still requires CI verification; local renderer CPU throttling does not throttle the worker.

Windows native final-output probes must interpret the console host's VT screen updates with xterm before requiring the exact 256 KiB payload and both boundary markers. Stripping escapes is insufficient: cursor redraws repeat bytes without adding visible characters, and regex stripping can leave fragments of OSC titles containing Windows paths. Retain the entire bounded payload in parser scrollback, and still reject missing, duplicated, or changed visible characters. Keep Unix output byte-exact. Never classify raw ConPTY stream length alone as data corruption.

The same VT rule applies to native-probe identity records and readiness markers. Windows can append erase-line and cursor-visibility controls to a TTY field or split a marker with a title change. Match these against the parsed screen, retain raw bytes for diagnostics, use an explicit identity terminator instead of a physical row boundary, and resize the probe parser with the PTY. PID and TTY validation remains strict.

Electron rebuild calls node-gyp without running node-pty's package postinstall. A clean build therefore loses the bundled `conpty.dll` and `OpenConsole.exe` unless `binding.gyp` copies the vendored binaries into `build/Release/conpty` itself. Keep this in the dependency's source-build patch so both development and packaging rebuilds restore the target-architecture payload.

The September 12 T3 Code comparison at `b1e223e2b0d87124883b1410ab52dd6a1338e40d` found automatic node-pty backend selection in its adapter and manual-only Windows tests. OpenWaggle's normal native probe now uses the same automatic selection as its shipping adapter, plus bundled ConPTY, without weakening lifecycle or payload assertions. Forced system ConPTY, bundled ConPTY, and WinPTY remain in the explicit `all-backends` diagnostic profile and manual Windows workflow. WinPTY's 3,000-row screen scraper lost the start of a 256 KiB burst at 80 columns before emitting any data; raw and parsed output both lacked the prefix while retaining the suffix. Increasing timeouts or changing VT parsing cannot restore those bytes. A green modern-Windows runtime probe does not establish lossless WinPTY support. Older hosts that select WinPTY still fail preparation on this probe. Windows app E2E remains a required Full-tier check, unlike T3's manual-only Windows lane.

On the local macOS host, login-shell probes with long `-c` arguments exited via signal before producing output, including a harmless `printf` followed by a long comment. Keep the allowlisted capture command compact with one loop, not one expanded capture block per variable. The compact probe preserves markers, shell startup, timeout, output bound, and process-tree cleanup. The exact OS-level signal source was not established.

### Reserved shortcuts have to be declared where the conflict check looks

`Mod+F` and `Mod+1` to `Mod+9` are registered directly by sidebar hooks rather than through `shortcutBindings`, so the settings conflict check could not see them and a user could bind a command onto one. The result was two live handlers and a console warning from the hotkey library with nothing in the UI to explain it. `RESERVED_SHORTCUT_KEYS` in `src/shared/types/shortcuts.ts` is where a directly-registered combination gets declared so the check can find it.

The table's keys are written `MOD+F`, while `shortcutBindingKey` produces `Mod+F`. Direct lookups such as `RESERVED_SHORTCUT_KEYS[shortcutBindingKey(binding)]` therefore never matched, so no reserved combination was ever flagged. Use `reservedShortcutLabel` from `src/shared/utils/extension-panel-shortcuts.ts`, which compares case-insensitively. `project-action-model.ts` still did the raw lookup when this was found.

### Extension panel shortcuts are a separate, conflict-free map

Extension side panel shortcuts (ADR 0043) are not Shortcut registry rules, because `ShortcutRule.command` is a closed literal union. They live in `extensionPanelShortcutBindings`, keyed by `extensionRightPanelSurfaceId`, so a binding survives uninstall and reinstall. Every write that touches built-in rules or these bindings runs `extensionPanelShortcutUpdateError` in `settings-operations.ts`. That check rejects only conflicts the update introduces, so a stale saved state never blocks unrelated edits. At dispatch they come after project and built-in rules and apply only outside terminal focus. Unavailable panels are left out of the capture, so their keys pass through.

An Effect `Schema.Record` whose key schema is a refinement drops keys that fail the refinement instead of failing the decode. A saved map with a bad key would load with that entry silently gone. Validate keys with a filter on the whole record when a present invalid value has to fail closed.

### Project action bindings are an ordered rule stack

Project action bindings deliberately do not use the conflict-free product Shortcut registry. T3 Code resolves its full keybinding list from the end, and several conditional rules may target the same project action or chord. OpenWaggle preserves that behavior: `when` uses the T3 boolean grammar, unknown context names are false, and the last active matching rule wins. Likely overlap is a warning, not a save blocker. Keep the legacy one-shortcut project shape readable, but write the ordered multi-rule shape after an action is edited.

### Setup dispatch belongs to a worktree generation

A Setup action needs a durable per-worktree-generation dispatch record, not a callback attached only to `git worktree add`. Record pending intent before Git creation or manual recreation and preserve it through deterministic adoption. Before terminal handoff, atomically change pending to claimed with a unique token. A reported pre-handoff failure may release that exact claim for retry; terminal acceptance marks it accepted without deleting the receipt. SQLite and a PTY cannot share a transaction, so a claimed row left by a crashed process is indeterminate and must never replay automatically. This gives arbitrary setup side effects at-most-once crash behaviour. It does not promise exactly-once shell execution, and the user may need to run the visible action manually when a crash happened before delivery. Legacy recorded trees have no row and do not run Setup retroactively.

Before starting a Project Action or Pi agent run in a managed worktree, compare the checkout's current directory identity with its saved preparation generation. A worktree recreated at the same path outside OpenWaggle can otherwise reuse Setup exports from the removed checkout. Guard both launch paths before handing those exports to an action runner or Pi shell; a worktree with no preparation snapshot remains launchable. POSIX Setup capture must also intercept escaped `\eval` (including dynamic nested eval) before its text can reach an escaped `\exec` and replace the shell without saving new exports. Test the capture behavior across the installed POSIX shells.

### One guided panel owns every action and preparation editor (ADR 0038)

Add/Edit action, Workspace setup/cleanup and the shared-preparation review all render in `ActionPanelLayout`, a shell-level `RightSidebarLayout` wrapped around `WorkspaceRightPanel`. It takes the single right-sidebar slot through a dedicated `action-panel` coordinator claim that remembers the claim it replaced, so closing restores that sidebar; any other sidebar taking the slot forgets the panel request but keeps its draft. A route or workspace release while the panel covers it clears the remembered claim, so a closed sidebar is never resurrected. Drafts persist per project under `openwaggle:action-panel:v1` and are validated with a lenient schema on load (drafts may be incomplete); one draft per project, resumed by target (`action:<id|new>` or `preparation:<profile>:<phase>`). Saving re-reads the catalog first, so changes made meanwhile surface as the plain "changed since you started" notice rather than the main process's generic revision error. Component tests must wait for the form, not only the panel: the loading chrome renders the same Close button and is replaced before a click lands. A preparation draft finds its saved setup by profile/phase slot, never by definition id: peers create independent ids for one slot and a save replaces the slot, so an id lookup reports a peer's replacement as "removed" and then overwrites it. Remembered script commands (for "Use the last known command instead") live in their own per-project store, `openwaggle:action-panel:script-commands:v1`, so typing never rewrites them. The panel's Escape entry is `enabled` only while focus is inside it: an enabled entry that declines through `shouldHandle` blocks every other `useEscapeHotkey` consumer. Saver enablement for shared preparation lives in the domain (`withSaverEnablement`), and a byte-identical re-save of someone else's pending change never enables it.

### The Panel rail sits on top of the old right-sidebar claims (ADR 0043)

The three nested right sidebars (`ActionPanelLayout` > `WorkspaceRightPanel` > the chat route's `RightSidebarLayout`) still exist and still compete through `useRightSidebarCoordinator`; the rail did not replace them. They now share one sizing preset and one storage key (`RIGHT_PANEL_SIZING`, `openwaggle:right-panel-width`), and `RightSidebarLayout` reads its width from `useSidebarWidthStore` so instances with the same key resize together. Component tests that resize must reset that store as well as `localStorage`. What the panel shows is derived, never stored: `resolveShownSurface` maps the active claim to `shown` (the surface whose icon closes the panel) and `highlight` (the rail entry it belongs to: a change request highlights Changes, an action run or the guided panel highlights Project Actions, a right-panel terminal highlights nothing). Features open surfaces through the command bus in `shared/lib/right-panel-surfaces.ts`; the shell's `RightPanelHost` registers the controller only on chat routes, so callers must keep a fallback when `hasRightPanelController()` is false. Opening a route surface hides the workspace panel first and opening a workspace surface clears the route panel, otherwise a stale `panelOpen` or `?panel=` reopens the other one on the next Session switch. Per-Session memory is recorded only while the route's Session id matches the active Session; during a switch the old Session briefly appears closed, and recording then made switching back lose its open panel. Rail order, pins, New acknowledgements and Session memory persist in `openwaggle:right-panel-rail:v1`; the first extension listing is acknowledged silently so panels installed before the rail are not all "New".

### Git stashes are shared by every worktree

`git stash` refs live in the common repository, not in a worktree. In a worktree with no local changes, `git stash -q` saves nothing and a following `git stash pop` applies another session's newest stash, conflicting dozens of unrelated files. Never use stash to compare against `HEAD`; run the check in a separate worktree or commit first.

### Action output terminal views are not terminals (ADR 0043)

A read-only action output tab lives in its own store (`features/terminal/state/action-output-view-store.ts`, `openwaggle:terminal-action-output-views:v1`), never in the PTY layout: a view has no terminal id, so close/split/clear/dock and the PTY lifecycle cannot reach it. It is keyed `(ownerKey = Session id, actionId)` and stores only the followed run ids; output is re-read from the Host's `output` pages on mount, so persistence after restart is cheap. A view covers the drawer only while the terminal tab that was active when it was chosen is still active (`coveredTabId`), so any shortcut that creates or selects a terminal tab uncovers it without extra wiring. Restart-following appends the next run of the same action only once the followed run is no longer active, so a concurrent finite task cannot take the view over. xterm needs `scrollOnEraseInDisplay` and the feed strips ED3 (`ESC[3J`, held across page boundaries), otherwise a dev server's clear-screen erases earlier runs above the "restarted" divider.

### Project Action completion is not an activity-change event

The reuse barrier must observe every successful process sample, including an unchanged idle snapshot. The authenticated next prompt is authoritative on integrated shells. A fast command can start and finish between polls, so two reliable idle observations after a 1.5-second grace release that missed transition; any unreliable sample resets the streak. This fallback cannot identify a long-running builtin in an unsupported shell because no child process or authenticated prompt exists, so keep that limitation visible in user documentation.

### The menu role and its keyboard model are one decision

`role="menu"` with `role="menuitemradio"` children tells a screen reader to use arrow keys. Declaring it on a panel of plain buttons produces a menu that is operable by Tab and Enter but announces a model that does not exist, which is worse than announcing nothing. `useMenuKeyboard` in `src/renderer/src/shared/hooks/` holds the model and `Popover` switches it on with the role, so the two cannot be declared separately. Items are found in the DOM rather than registered by each call site, because a menu's items are arbitrary children.

### Session Host authority and subscriptions are live boundaries

Project approval grants and revocations must use the same owning Host as project preference
writes. Both update `.openwaggle/settings.json`, and the write queue is process-local. A GUI-local
write can otherwise race a CLI-owned Host and restore a successfully revoked grant. Route both
mutations through the Host's validated application operation, require protocol revision 10, and
retain GUI-only caller authority. A remote Host failure must not fall back to a local write.
Deterministic tests hold a real config rename to verify overlapping writes preserve both changes.

Pre-agent worktree progress is Host-owned run state too. Publish it through the Session Host event
stream, seed the reconnectable stream buffer before `agent_start`, and relay it to renderer windows.
A GUI-local broadcast is invisible when a detached Host owns the Run and cannot survive reconnects.

Session authority stores canonical project and workspace paths as a durable snapshot, then checks
the live Run scope again for long-running operations such as exports. Tests for these boundaries
must use real canonical directories; invented paths exercise rejection rather than the intended
authorization branch.

An Effect tagged error with no `message` field reaches `Effect.runPromise` callers as a
`FiberFailure` whose message is the placeholder "An error has occurred". Every
`LocalSessionCommandAuthorizationError` looked like that in the Sessions tool, which hid a plain
`target_scope_denied`. Render failures that leave the Host through
`sessionCommandFailureMessage`, and assert the rendered text in tests, not only the error code.

A root Session agent's catalog-wide reach (ADR 0042) is decided by one function,
`sessionAgentRunReachesEveryProject` (`adapters/session-agent-run-project-reach.ts`), called by
`resolveSessionToolAgentCaller` when the tool is called and by `sessionAgentBlockReason` when a
queued Follow-up is delivered. It needs both the Session's own authority
(`rootSessionReachesEveryProject`: a root from the local user or a catalog-wide profile, origin read
from the caller id) and the Run's initiator (`session_runs.intent_json.callerId`, followed through up
to eight other Sessions, counted by distinct Session so Follow-up round trips between two roots do not exhaust it early, and at most 256 Runs, about 128 round trips; limits apply to the whole initiator tree; `walkRunInitiators` in `application/run-initiator-walk.ts` reads each Run once and is order-independent). Without the initiator check, a project-scoped CLI profile could message a desktop
Session and have it act in every project. Input into a running catalog-wide Run (steer, promote,
request/approval respond) from a narrower caller is refused in `local-session-run-input-reach.ts`
(`runInputWidensReach` on the authorization target port). A Follow-up the desktop user adopted
(`queue-adopt`) keeps its original writer in `intent.authorCallerId` as provenance only: reach and
ceiling read `callerId`, because adopting is the user choosing to send it as their own. Its
attachment rows stay owned by the author: every resolve or release of a Follow-up's attachments
(Run dispatch, Run-end release, promotion resolve and release) uses
`followUpAttachmentOwner(intent)` = `authorCallerId ?? callerId` (`message-aggregate.ts`); using
`callerId` failed promotion of an adopted Follow-up with `attachment_resolution_failed`. Every
needs-attention path also pauses the queue (`applyFollowUpAuthorizationState` with no pause reason,
profile revocation with `profile-revoked`), so `adoptFollowUp` resumes the queue in the same
mutation when it is paused with no reason or `profile-revoked` and no item still needs attention;
`requested` (and run-failed, host-lost, parent-limit) stay paused. `queue-adopt` is a delivering
operation, so an idle Session then starts its head through `deliverAfterQueueDecision` (head
authorization, parent limit, Host ceiling; a refused admission re-pauses) and the outcome is
`started-run`. Clients gate `queue-adopt` (and every command) by the shared
`requiredLocalSessionCommandRevision`; `local-session-client.ts` keeps no copy of the rules.
`queue-list` `source` is `{ callerId, sessionId?, sessionTitle?, profileName? }`: `sessionTitle`
is the agent Session's title when the lister may see it (desktop user: any; profile or agent: by
`authorizedSessionScope`, archived and other projects included), never its id replaced. A Session agent's Authorization ceiling is
also clamped by its Run's initiator (`session-host/session-agent-run-ceiling.ts`, used by the tool
caller and `getSessionCallerAuthorizationBoundary`); an unidentifiable initiator counts as
ask-for-approval. An agent-requested Waggle's Run id is `waggle-of-<classicRunId>` (`requestedWaggleRunId`) so these checks can find its classic Run, and it inherits that Run's authorization context through `runIfRequested({ authority })`. Anything that needs the Waggle's durable Run (report source, spawn parent, reach, ceiling) reads `durableSessionRunId(runId)`. `queue-adopt` (desktop user only) needs `sessions:queue` and `sessions:authorization`. Reports are content,
not commands: the Host labels them but does not track information flow. Session agents with catalog-wide
scope may launch or create only in projects already in the catalog (`session-tool-project-catalog.ts`).

Agent tool processes get `TMPDIR`/`TMP`/`TEMP` pointing at a per-Session 0700 scratch directory
through the Pi bash and PowerShell `spawnHook` in `pi-run-session.ts`, applied after the prepared
Workspace environment. Keep that path short: macOS limits a Unix socket path to 104 bytes and
`tsx`, Chromium, and others bind sockets under `TMPDIR`. A scratch dir under `os.tmpdir()`
(`/var/folders/...`) plus a UUID was 108 bytes and crashed `tsx`, so `pnpm verify` and `git push`
failed from agent shells; it now lives at `<base>/ow-scratch-<uid>/<8-hex profile hash>/<12-hex
Session hash>`, where `<base>` is the user temp directory if the path fits 56 bytes, else `/tmp`. The profile hash (from the Host's user-data root) keeps each OpenWaggle
profile's Host from sweeping another's directories; the startup sweep
(`session-scratch-sweep-background`) removes directories of Sessions deleted or archived while no
Host ran, and another profile's namespace once the user-data directory named in its `.owner` marker is gone (unmarked namespaces: after a week unused). `prepareSessionScratchDirectory` touches
the mtime because the sweeps judge age by it. Screenshots meant for the user or another Session go to `$OPENWAGGLE_EVIDENCE_DIR` (`<base>/ow-scratch-<uid>/<profile>/evidence/<session>`, `utils/session-evidence-directory.ts`), which survives archiving and is an image capture root for every Session: a Worker's scratch directory is deleted when cleanup archives it, so a Queen could not render screenshots saved there. An OpenWaggle process started from an agent shell
restores `TMPDIR` from `OPENWAGGLE_HOST_TMPDIR` at startup (`restoreHostTemporaryDirectory`). Code that
must agree with the Host on a temp path (the Session Host socket fallback in `local-session-paths`)
reads `hostTemporaryDirectory()`, which prefers `OPENWAGGLE_HOST_TMPDIR` exported next to the
scratch `TMPDIR`. The Host deletes the directory from `session-host-events.ts` on
`session-list-changed` `archived`/`deleted`, but a Run holds it (`withRetainedScratchDirectory`), so
an archive mid-Run defers the removal to the Run's end. Tests that run `runPiAgentKernel` must mock
`utils/session-scratch-directory` or they create directories in the real temp directory.

A spawned Worker's authority snapshot stores its
project, never `all`, even under a catalog-wide Queen (`workerAuthorityScope`). An unreadable
authority snapshot counts as changed authority in `sqlite-session-live-authority`; letting the decode
error escape failed the whole Run settlement.

A failed Local Session handshake must not name its code: `profile_not_found` and
`profile_revoked` overlap the authorization codes. `local-session-connection.ts` sends one message
and logs the reason; `sessionCommandFailureMessage` also maps a stray `LocalSessionAuthenticationError`
to that message. The Sessions tool and command error frames both render failures through
`sessionCommandFailureMessage`, which falls back to the allowlisted `describeLocalSessionServerError`.

A schema copied with `{ ...schema }` loses TypeBox's non-enumerable `~kind` and `~optional`, and
`Type.Optional` then adds `~optional` as a visible key that reaches provider payloads. Copy with
`Object.getOwnPropertyDescriptors` when decorating a TypeBox schema.

Native Session capabilities constrain OpenWaggle tools and the Session Host API. They are not an
OS sandbox against arbitrary commands from another process running as the same user. A hostile or
YOLO shell needs a separate account, container, or operating-system sandbox for containment.

Session semantic discovery keeps vectors only for the 100,000 most recently updated Sessions and
enforces the same limit in the resident exact index. A larger corpus is terminally `partial` once
that hot tier is prepared; hybrid discovery then uses the complete lexical index, while
semantic-only discovery may search the explicitly partial tier. Tier rotation must prune cold queue
rows and advance the deletion-compaction watermark so an evicted Session is neither re-embedded in
a loop nor retained by a stale resident snapshot.

Transcript term cutover must page with the three-column `(session_id, created_order, id)` tuple.
Expanding that comparison into OR predicates made SQLite rewind the node index for every 512-node
batch, producing quadratic prefix scans. Keep the production-query plan regression requiring an
indexed seek, along with tied-order and content-byte-boundary traversal coverage.

Batch document validation must start from the requested Session ids and left-join persisted
documents. An inner join let SQLite scan all 100,000 documents for every 512-node batch; the
left join also catches missing documents explicitly. Keep a temporary covering index on grouped
terms `(session_id, occurrences)` so per-Session token totals do not rescan every batch term.
Production-query plan regressions protect both boundaries without relaxing integrity checks.

Stage transcript terms by grouping FTS occurrences before looking up their previous persistent
counts. Joining the persistent term table first performed the same primary-key lookup once per
occurrence instead of once per distinct term/Session pair. Preserve the earliest node/Run evidence
and cumulative counts across batch boundaries; production-query instrumentation and a multi-batch
cutover fixture cover both. The paired production trial retained identical term, document, and
node-search rows with every cutover validation enabled.

Unscoped transcript-term ranking excludes the archived Session id set instead of looking up
the full Session row for every posting. Project and working-path filters still require that join;
authority and archive filtering must stay before the bounded ranking window. Exclude null ids
from the archive set so malformed legacy rows cannot poison SQL `NOT IN` semantics.

Discovery ranking reads Session id/archive metadata through the FTS5 content table's integer
rowid. SQLite documents `c0`/`c1` as the exact stored values of the first two FTS columns; this
avoids repeated FTS content callbacks without copying metadata or changing BM25 scores. Keep
that join read-only, preserve the FTS column order, and compare scores, ties, live mutations,
and pre-limit authority/archive filtering against the public FTS interface in regression tests.

Dense single-ASCII-token discovery can rank one native FTS representative per exact signature
of objective frequency, preview frequency, and total native token length. Do not copy BM25
arithmetic or persist scores: even equivalent arithmetic changed a score by one ULP. Bound the
signature probe and candidate work, retain native fallback for sparse/diverse signatures, and use
one SQL snapshot for admission, scoring, archive filtering, and the final Session-ID tie order.
Scoped, phrase, multiword, non-ASCII, and full-transcript requests retain their existing paths.

Discovery term postings follow the canonical discovery-row mapping through foreign-key cascades.
Incremental updates tokenize one document in a shared staging FTS inside the same transaction,
using the same native tokenizer. The staging table must be empty after success or rollback. A live
instance vocabulary filtered by document does not seek that document and would scan the entire
corpus per edit.
Migration 33 and legacy cutover group a single native vocabulary traversal, validate mappings
(including empty documents), postings and signatures, then install incremental triggers. Keep
schema revision 18 and the one-time cutover contract; existing targets apply migration 33 once.

Lexical evidence prepares query clauses and snippet terms once per result batch, lazily on the
first discovery match. Entirely ASCII input skips per-character Unicode normalization but retains
the same lowercasing and token regex. Mixed or non-ASCII text uses the original Unicode path;
do not broaden this fast path without token-sequence parity tests.

Node-delete search triggers must requeue semantic work only while the owning Session still
exists. During a Session cascade, the parent row is already gone; unconditional queue inserts
recreated a foreign-key dependency and made deletion preflight reject populated Sessions.
Migration 32 replaces that trigger in existing targets without repeating the legacy cutover or
changing schema revision 18. Standalone node deletion must still invalidate the surviving Session.

The September 2026 terminal/browser merge preserves released setup migrations 26/27 and moves
the prerelease Hive identities 26–31 to 28–33. `session-host-ledger-compatibility.ts` plans only
exact known-name mappings, and the owner applies them descending in one transaction, preserving
timestamps. Read-only completion preflight recognizes old alpha ledgers without mutating them.
Unknown or mixed identities fail closed. Desktop owner/fence journals are migration 34; immutable
browser attachment metadata is migration 35. Never reuse the old bare numeric Hive IDs in tests.

Session Host authority does not imply native desktop ownership: GUI owns actual PTYs/WebContents,
Host owns canonical mutations and uses the revision-11 authenticated desktop reverse bridge.
Native fences and exact GUI/Host closure receipts are durable. A released token remains until its
GUI native hold is acknowledged; lease expiry or PID absence never establishes process settlement.
Unclean GUI ownership and orphan active Host mutation fences remain in doubt, not auto-released.
The quarantine notice (a banner, not a toast: the archive failure it causes is a toast) offers
**Recover desktop tools** (ADR 0049). `recoverOwner` replaces the bridge's first `register` and is
answered like it; in one admission the Host releases active fences of dead Hosts, replaces the
exact stale owner in one SQLite transaction (`replaceStale`), and registers. Any failure before
acceptance ends that bridge, so the pump never replays the attestation. Quit cleanup awaits an
in-flight recovery (bounded by the drain deadline) before stopping the bridge. The renderer keeps
the notice in one store so a Settings round trip keeps an in-flight recovery.
Without this, one failed quit (Host unreachable during drain) left `desktop_native_owner` active
forever: every launch was quarantined and every archive failed with "An attached OpenWaggle
desktop is required".
`execFile` Git children have no kill-on-Host-death guardian, so closing GUI resources alone cannot
prove an old filesystem mutation settled. Browser screenshots become composer attachments only
after Host preparation returns a durable capability, including immutable bytes/context/provenance.

Desktop shutdown needs both a fresh post-drain fence snapshot and the in-flight poll to settle.
Two normal five-second polls exhausted Electron's ten-second quit budget and quarantined the next
GUI after forced cleanup. Keep normal polls at five seconds, but pace draining polls at 100 ms.
The real broker/bridge regression verifies prompt idle shutdown and that active fences still block
the clean receipt. Shortened mock polls alone did not expose this integration failure.

Hidden terminal panes retain renderer input ordering after their viewport detaches. Host archive
can delete the corresponding native record without an attached pane receiving its close event.
Reopening the same owner/terminal ID therefore needs an attach-time native record identity, not
just the retained renderer generation or numeric shell generation. Keep that identity stable for
ordinary Restart and viewport moves, but reject late writes and readiness from a deleted record.
The combined real TerminalService/dispatcher regression reproduces the sequence-gap failure;
the hidden Electron archive test also verifies actual shell input after reopening.

Semantic backfill must bound the ordered queue page before joining Session documents. Rebuilding
and sorting the entire hot tier for each 128-row batch made the 100,000-Session preparation exceed
its release budget. When the full corpus fits the tier, exact counts can bypass hot-tier joins;
evaluate that condition inside the same SQL snapshot and recheck membership after model inference
so a concurrent insertion cannot publish a newly cold Session.

Phrase search should retain its earliest matching node during the initial FTS scan. Rechecking
every candidate node repeats FTS posting traversal and scales with transcript length. SQLite's
single-MIN bare-column selection preserves the matching node here because Session created_order
is unique; keep the regression asserting earliest node/Run attribution and the query-plan guard
against correlated rowid-plus-MATCH re-probes.

Windows libuv named pipes use the operating system's default security descriptor, which grants
Everyone read access and lets another account occupy a duplex server's read-only connections.
Session Host pipe names therefore rotate after canonical database ownership is acquired, clients
reread the protected endpoint capability while attaching, and the Host applies and verifies a
protected current-user-SID DACL before opening admission. Keep the Windows CI integration test for
this boundary. Named pipes require handle-based `SetSecurityInfo`/`GetSecurityInfo`, using
`CreateFile` with security-metadata rights only. Keep pre-admission rejection active while the
helper runs. Bounded stage diagnostics distinguish helper startup, input, and native API stalls;
Unix unit tests cannot prove live Windows handle behavior or DACL readback.
Use the explicit `System.IO.Pipes.PipeAccessRights.FullControl` mask (`0x001F019F`) in
both the requested pipe descriptor and its readback check: generic access bits are mapped
by Windows and are not a stable readback representation. Require one unconditional,
non-inherited Allow ACE for the current user, a protected DACL, and that exact mask.
Native regression probes must validate later pipe instances without reapplying protection;
descriptor fixtures also check that narrower rights, extra principals and extra rights fail.

After a Windows Host replacement rotates `endpoint.capability`, GUI commands must reread the
protected endpoint before their first dispatch, including non-replayable Waggle, compaction,
attachment, and Local UI mutations. Only replay-safe contracts may retry after an ambiguous
transport failure. Renderer event watches must refresh their retained paths before reconnecting;
Host UI and MCP owner operations use the same refreshed authority. Fence asynchronous GUI route
refreshes by the external configuration/retirement epoch, not the route object's identity, so
concurrent ordinary commands do not invalidate otherwise valid Host UI work.

After profile revocation, stored credential and receipt cleanup may ignore only `ENOENT`.
Permission, locked-file, and directory-read failures must reach the CLI/GUI so retained files
can be removed. Cleanup failure does not undo revocation or prevent admission disconnection.

The bound credential installer has two generated protected artifacts in its destination directory:
`pending` for the new bearer and `displaced` for the original during replacement. A failed
pending unlink may ignore only `ENOENT`; failed rollback must report `displaced`, and an
indeterminate child exit after mutation must conservatively report both possible paths. Propagate
those additional recovery locations through the staged commit error and accepted GUI/CLI response,
alongside the original staging path. VM tests cover cleanup errors and rollback branches, but do
not substitute for native Windows locking and ACL checks.

Restricted event subscriptions are filtered at admission before bounded buffering. Exact Session,
project, workspace, and Hive scopes use a synchronously readable authorized-Session snapshot that
is refreshed on authentication, profile changes, and lineage-producing lifecycle changes. Events
outside that snapshot, or whose event kind lacks the required base or derived capability, consume
no subscriber capacity and expose no cursor advance. Query, subscription, event-envelope, and
resynchronization cursors are fresh authenticated opaque capabilities bound to the caller authority;
they resume statelessly on the same Host without revealing its global sequence or hidden-event gaps.
Restricted replay uses at most 128 LRU authority views, each capped at 256 visible events and 256
KiB, for at most 32 MiB of retained serialized payload and 32,768 envelope references; publishing
therefore performs at most 128 synchronous admission checks. Views retain shared envelope references,
not payload copies. Hidden events never enter a view or advance its expiry floor. Authority-view LRU
eviction, refresh, or revocation expires its cursors and forces attached subscriptions to resynchronize.
Requested Session filters are intersected again for replay and live delivery, but the replay floor is
authority-wide: traffic from another Session visible to that authority may expire a narrower consumer.
Per-event live authorization still refreshes revocation, capability, and derived grants, but must
not rebuild the filesystem/workspace/catalog admission snapshot for every streamed token. An
admission refresh explicitly invalidates existing streams; clients resynchronize from canonical
state or retained replay rather than silently losing events that race the fence.

A lineage-producing lifecycle command must release its issuing socket's admission reader after the
mutation commits and before it refreshes every profile admission. Refreshing while the command still
holds that reader fences and waits on itself, eventually disconnecting the CLI after a successful
create, fork, launch, or spawn. The release hook is idempotent, input on one socket remains serialized,
and the global refresh still completes before the lifecycle response is written or a new Run starts.

Paginated active-branch exports must pin the selected branch head on the first page and carry that
immutable node through every continuation. Re-reading `session_branches.head_node_id` per page lets
concurrent tree navigation silently truncate or mix the exported artifact.

Credential-verifier work may deduplicate only an exact canonical operation. A caller id and
idempotency key are insufficient because persistence scopes idempotency by operation and target;
include the normalized target and credential fingerprint so concurrent profile operations cannot
share the wrong verifier.

Agent-definition semantic catalogs must load the same enabled OpenWaggle-managed Pi packages and
resource roots as a real Session Run, including runtime load-failure isolation. A catalog built from
bare project Pi resources incorrectly rejects valid managed-extension tools and skills.

Restricted CLI profile edits must preserve undisplayed export/attachment roots and the existing
delegation management envelope, including its absence. Initialize an envelope only when granting
profile management explicitly; remove it when that capability is removed. GUI update requests use
`profileName`, not the create-only `name` field. Component tests should decode submitted commands
through the real shared strict schema so an API mock cannot hide invalid wire payloads.

GUI-only `/compact`, `/fork`, and `/clone` commands require an idle Session. Busy submissions retain
the draft and attachments and explain that requirement; they must not enter the durable model-message
queue. Promotion also rejects legacy queued GUI commands instead of sending them to the model.

The Settings project picker must discover older active Session projects through the Host rather than
the renderer's loaded Session slice. Non-empty substring search uses a per-database Host cache of
distinct active paths, invalidated by a durable generation trigger on Session insert, delete,
archive, or path change; SQLite `lower()` is ASCII-only and FTS trigram cannot cover short or
canonically equivalent composed/decomposed queries. Agent-definition authorization for an older
project uses an indexed exact-path existence check, not an unbounded Session projection list.

Native Project Actions are specified in ADR 0035. Definitions are project-scoped and private by
default; only explicit sharing writes `.openwaggle/actions.json`. The detached Session Host owns
action processes, while the GUI reconnects to durable run IDs and output cursors. Workspace mutation
admission must serialize launches against final binding release and physical worktree removal.
The native action manifest caps shortcut rules both per action and across all actions in one
manifest at the shared 256-rule project limit. Also count the effective catalog after personal
overrides merge with shared definitions: independently valid manifests can otherwise exceed the
project limit. Enforce this on read and edit before Settings builds its pairwise shortcut browser
rows, counting a hidden shared definition only when it is not overridden.
Keep the Pi-native `project_actions` tool's registered schema flat at the root. Some
OpenAI-completions providers emit empty arguments for a root `anyOf`; use an `action` literal union
with optional fields in the provider schema and validate each action's required fields before work.
Output polling stops after the final page of a terminal run. Publish terminal status only after
process cleanup, output flush and metadata persistence succeed; concurrent Stop joins that pending
finalization instead of writing a later stopping status over completion. Failed finalization keeps
the run active and owned so its error remains visible and Stop can retry.
Preparation snapshots retain private successful exports and require review for changed shared
execution. A failed cleanup keeps the worktree and must remain discoverable in Settings after the
owning Session has been deleted. Pending worktrees can have ordinary future filesystem paths, so
definition management must use authoritative lifecycle state instead of testing only `pending://`.
Profile moves are execution changes even when setup commands match. Retain the approved profile's
name and ID in local review records so the dialog can show the old and new profiles after deletion;
older reviews can recover the ID from a validated execution fingerprint.
Settings worktree removal must validate Git's non-forced dirty-worktree refusal before running
arbitrary Cleanup, then revalidate after Cleanup because the command itself can dirty or lock the
checkout. Keep both checks inside the admitted removal operation. If Git refuses after Cleanup
succeeded, retain that completed preparation in Settings and offer Retry removal, Delete anyway,
and an explicit Force remove decision. Parse `locked` records from `git worktree list --porcelain -z`;
Git requires two force flags to remove a locked checkout, so never apply them without the user's
explicit force choice.
Workspace deletion cascades preparation secrets and action records, then drains a durable output
cleanup queue. Disk cleanup failures remain queued and must not block Host startup or other owners.
Action copy buttons use the existing Electron clipboard bridge; the browser clipboard API is denied
by the renderer permission policy. Copied task invocations must quote literal arguments for the shell.
Final local Session deletion retires its Workspace resource only after all durable bindings,
including archived Sessions, are gone; stop finite runs as well as services before that cascade.
Setup capture must use the ordinary action shell resolver and shell-native exit handlers, including
fish, so configured shell syntax and explicit successful exits preserve exported environment.
Fish reserves `exec` as syntax, so a function named `exec` cannot intercept process replacement.
Rewrite direct Fish Setup command-position `exec` to a helper that snapshots exported values before
the real `exec`; preserve arguments, quoted text, and comments.
On Windows, resolve PATHEXT shims before extensionless files when an action command has no
extension. npm/Corepack directories can contain both a POSIX shim and a `.cmd` shim; choosing the
POSIX file bypasses the PowerShell wrapper and fails in node-pty. Output-derived previews must
accept complete IPv4 loopback addresses, not DNS names that merely start with `127.`.
POSIX setup may source scripts that register their own EXIT cleanup; keep the environment capture
handler authoritative while preserving user cleanup, including explicit successful exits.
POSIX setup may also replace its shell with `exec`, which skips EXIT capture. Expand an `exec`
alias only when parsing user commands so a snapshot is written before replacement, including from
sourced scripts. Expand capture through a silent command substitution within the same `exec` command:
splitting it with `&&` drops temporary assignments such as `FOO=bar exec tool`, while a shell
function around `exec` breaks redirect-only forms such as `exec >log`.
The valid `command exec` and `builtin exec` forms suppress the direct `exec` alias. Snapshot when
their prefixes expand too; retain their command status and temporary-assignment behavior.
An unquoted escaped `\\exec` suppresses alias expansion while still invoking the shell builtin.
Normalize that token in a direct POSIX setup command before parsing it for capture, preserving
quoted literals, comments and heredoc bodies.
`command trap` and `builtin trap` can bypass a `trap` function or alias in sourced setup scripts.
Route their prefixed forms through capture's saved-trap handler, while retaining pre-assignment
environment snapshots for prefixed `exec`. Ksh-style function definitions preserve temporary
assignment export behavior in ksh. Run saved EXIT cleanup with the setup's original status as
`$?`, including failed exits under `set -e`; the final process status remains the setup status.
One-argument `trap EXIT` and `trap 0` reset only the saved user cleanup; they must retain the
environment-capture handler. Select the first available capture-capable shell among the normal
shell candidates, so an unsupported configured shell does not block setup when a fallback exists.
Fresh local Sessions need Summary availability from configured preparation, before a snapshot or
run exists, or users cannot reach explicit setup.
Native actions use Local Session protocol revision 17 and require matching clients/Host for this
breaking migration. Revision 16 belongs to Host-owned Session resources, revision 15 to worktree
launch events and revision 14 to update channels; their published tuples stay unchanged, but removed legacy action channels make all three
older revisions incompatible. Keep safe Host drain/handoff.
Package task discovery checks the nearest package lockfiles before walking toward the Workspace
root when no packageManager is declared; explicit child and root declarations keep precedence.
The 1,000-task discovery page is a UI bound, not a validity bound for saved actions. Resolve an exact
saved package or Hatch reference through its provider and current source even when it lies beyond
the page, while still checking that the source belongs to the declared workspace and the task exists.
The Actions menu must not disable a saved task merely because its reference is absent from that
capped page; let backend preflight validate it at launch. Cargo aliases beginning with `+` are
toolchain selectors in Cargo's CLI, so reject them even though other task names may use `+`.
Keep aggregate task-limit diagnostics project-relative; their `source` is rendered in the editor.
In Setup shell capture, rewrite escaped `eval` only when it is a command (including after shell
keywords), not when it is an unquoted argument. Apply the same rule to code reparsed by runtime
`eval`, or preparation can change captured environment values such as `printf '%s' \eval`.
Determine command position by scanning shell words: quoted or escaped whitespace and separators
may belong to an assignment prefix before `\eval`, so a whitespace-only prefix regex can miss
the command and let a following escaped `exec` bypass capture.
A `)` after a `case` pattern starts the arm's command list, including when an optional `(`
opens that pattern, even on a later line; treat the closer as a command boundary in both static and runtime scanners
while retaining nested group state for other parentheses.
Leading redirections, including an optional numeric descriptor and a separately quoted target,
also preserve the next command position; consuming a redirection target must not make an
escaped `eval` argument of a preceding command look like a new command.
Treat a standalone `{` as a shell command prefix, but keep braces embedded in parameter and
brace expansion words; those expansions must not turn an escaped `eval` argument into a command.
An unquoted backslash-newline pair is removed before shell tokenization; prefix scanners must
skip it without adding a word, whether `\eval` is the next command or an ordinary argument.
Interrupted sharing journals pin the filesystem directory identity and durable Workspace resource.
Recovery keeps a draft when the checkout is missing, replaced, or releasing; publication must never
recreate a deleted checkout. Private preparation retains its profile metadata so a teammate removing
the shared profile cannot invalidate unrelated local configuration.
Deleting a local profile override should reveal the same-ID shared profile when one exists, even
if Setup uses it; explicit deletion must not rehydrate the local copy and mask later shared edits.
Fish reserves `eval` and `exec`. Rewrite evaluated commands at runtime, but execute `eval` in its
caller scope so local exported variables survive until Setup's environment capture.
Fish command substitutions start a nested command position. Their closing `)` restores the
enclosing command's argument position in both the static and runtime scanners; otherwise an
escaped `eval` argument after the substitution can be rewritten as a command.
PowerShell native-exit classification may resolve inert string concatenation in a command target,
but must not reevaluate a subexpression that can run user code.
Shared publication captures the current inode into a pinned, journaled recovery directory and
installs the prepared file with an exclusive hard link. Never replace a competing target or infer
completion from matching bytes alone. Keep both files in Git-ignored `.openwaggle/action-recovery/`
until manual review: editors holding an old descriptor can finish writing after publication.
Pending-save details expose the recovery path; missing or replaced recovery identities retain drafts.
Cargo alias discovery accepts both `.cargo/config.toml` and legacy `.cargo/config`, preserving the
selected source in saved task references and reporting conflicting files rather than guessing.
Successful setup stores explicit environment removals as private null markers. Apply these after
inherited environment construction for actions, cleanup and Pi shell tools; otherwise inherited
Host variables reappear after setup unsets them. Public preparation projections exclude this map.
Pi's shell spawn context starts from the detached Host environment, not Session workspace metadata.
Inject the Session's repository root and run working path into both Bash and PowerShell spawn hooks
after filtering inherited or prepared values for the reserved names; a test that pre-seeds those
paths into a mock spawn context misses this defect. Exercise the real Pi Bash tool as well.
Host recovery must mark interrupted preparation and action runs before replaying pending Session
deletions or worktree removals, so cleanup cannot execute twice after a crash. Preparation output
checkpoints retry from the last persisted revision. A failed final save retains a failed live
snapshot and prior successful environment, keeping Retry and Continue available until persistence
recovers. After an action process spawns, a failed write of its `running` status must return the live
run instead of reporting launch failure while leaving the process active. Keep Stop, output and
request replay available from the active map, and retry the durable status write for quiet services.
Agent authorization includes preview URL and automatic opening because both cause side
effects. Resolve relative PATH entries and executable paths from the action directory, including
setup shell selection. Hatch environments inherit ordinary scripts by name, but replace the entire
extra-scripts option; parent matrices do not make explicitly named child environments ambiguous.
Action approval messages use the current Session workspace as `.`. Keep the absolute workspace path
only in the hashed authorization scope so separate worktrees cannot share an approval, and never
render OpenWaggle's worktree-storage path in Start, Restart or Stop prompts.
Bind renderer Start and Restart requests to the execution key of the displayed definition. The
Host must refuse a changed action before launching a command that differs from what the user saw.
Use an ordinary scrolling container around the disabled action-editor fieldset; Chromium fieldset
overflow can paint over a fixed footer. Keep save errors in a bounded area above that footer so
revision-conflict recovery stays visible even when the form body is scrolled to the top.
Action-run polling queries all active runs plus the latest 50 terminal runs through indexed partial
branches. Additive migration 61 keeps older runs and request IDs available for detail lookup and retry
deduplication; limiting polling must never truncate the active-run set.
On macOS, setup environment capture uses bundled Perl to emit NUL-separated values because `env -0`
is not a documented cross-version contract; preserve embedded newlines. Resolve task executable paths
through the action runner's PATH/PATHEXT lookup before embedding them in a PowerShell setup wrapper,
so Windows selects the same `.cmd` shim as an ordinary action run.
Reconcile unsent worktree preparation choices against catalog updates even when the chooser becomes
hidden with only one profile; a deleted profile must not remain in the draft sent to a new Session.
Before a first worktree send creates a Session, read the live project catalog and require an explicit
valid profile when more than one exists. This preflight must run for classic and Waggle sends even
while the chooser's catalog request is still loading; otherwise the new Session can strand the first
message at setup snapshot capture. Carry the preflighted sole profile ID across Session creation and
select it explicitly; another window may add a profile before the first turn. Automatic Setup belongs
only to the durable worktree-birth callback. An idle Setup selected or adopted on an existing checkout
remains manual until the user chooses Run setup. Bash/zsh Setup trap introspection (`trap -p EXIT`
and bare `trap`) must report the saved user handler, never the private environment-capture handler:
a sourced script that saves and later evaluates the private handler recurses at exit. POSIX Setup
capture must snapshot before each runtime `eval` and normalize escaped `exec` inside literal
eval bodies so the exec alias captures any exports made within the evaluated string. Dynamic
`eval "$code"` needs a runtime rewrite too: the static scanner cannot see its expanded body, and
an escaped `\exec` would replace the shell before its EXIT handler saves later exports. Preserve
quoted strings and heredoc bodies while rewriting, and fail Setup if the runtime rewriter fails.
ANSI-C-quoted Bash builtin names such as `e$'va'l` and `ex$'e'c` also suppress alias
expansion. Normalize those command words in both the static and runtime Setup scanners,
including numeric ANSI-C escapes, before an evaluated `exec` can skip environment capture.
Bash locale-quoted words such as `$"ev"al` and `ex$"e"c` suppress aliases in the
same way. Recognize their literal command names in both scanners without rewriting
ordinary arguments.
Gate dollar-quote parsing by the selected shell: dash lacks both ANSI-C and locale
quotes, while zsh accepts ANSI-C quotes but treats Bash locale quotes as literal `$`.
Resolve `sh` symlinks before choosing the parser mode, so Linux dash-backed `sh` and
macOS Bash-backed `sh` retain their own command behavior.
Action-run headings and repair drafts display the actual invocation directory relative to the
workspace or project root, including nested package paths.
PowerShell setup capture must decide success from the
last command's `$?`, using `$LASTEXITCODE` only for a failed final command. A handled earlier native failure can leave
`$LASTEXITCODE` nonzero even though the final setup command succeeded and exported its environment.
When that final command is a failed non-terminating cmdlet, `$?` is false while `$LASTEXITCODE`
can still be zero; return a nonzero setup status and do not persist the environment snapshot.
Apply the same final-status rule to ordinary PowerShell custom actions: an earlier handled native
failure must not mark a successful final command as a failed action. The single `.cmd`/`.bat` shim
wrapper still uses its direct native process exit code.
PowerShell Setup capture initializes its wrapper status to success before user code: a dot-sourced
script can `exit 0` from inside `try` before the post-command assignment. Its `finally` block must
still write the environment snapshot, while the preparation executor only reads it for exit code 0.
Within the Workspace mutation fence, archive first, then stop services only after the archive
commits and removes the last active binding. A failed archive must leave running services alive.
Managed-worktree Session deletion also validates Git before commit. Inspect the binding after the
delete operation before stopping action services: a dirty-worktree refusal leaves the Session and
its services active, while a post-commit cleanup error may still leave an orphan to stop.
After a committed archive or handoff, a service-stop failure must not make the mutation appear to
fail. Retry cleanup under the Workspace fence, checking active bindings again so a rebound Workspace
keeps its services. Managed runs retain ownership while stop cannot be confirmed.
Prepared setup exports must not capture or override OpenWaggle's current project root, worktree path,
or agent-run marker. Pi Bash and PowerShell receive the active run's authoritative Workspace context.
Persisted `starting` runs must be tracked before native launch. Stop aborts launch promptly and the
PTY checks cancellation immediately before spawning; any late process remains owned until its tree
is confirmed stopped, with failed cleanup visible and retryable.
If a launch fails after its initial `starting` save and persisting the terminal failure also fails,
retain the failed run in memory for polling and Stop. A concurrent Stop can write `stopping` after
the launch's terminal save, so Stop must persist the terminal result again before releasing the
starting entry. Only a durable terminal state may disappear from in-memory recovery.
Preparation launches need a linked abort signal passed into the process runner. Stop and Host
shutdown must settle while native PTY module loading is stalled, even if launch never returns.
Race launch against cancellation, check the linked signal before invoking the runner, and stop a
process returned late after cancellation without blocking the canceled caller.
Settings catalog, discovery, and edits use only the independently selected project path. Its active
Session scope is reserved for the running-actions summary, since that Session may use a worktree.
Shortcuts Settings reads and writes also use that project-only scope; runtime shortcut presentation
and the command palette may follow the active Session. A worktree-scoped definition must not become
a project-wide local override through a Settings edit.
Preparation approval fingerprints include the profile ID as well as phase and invocation. Moving
shared setup into another profile changes which workspaces enroll and requires renewed review, even
when the command itself is unchanged. Older fingerprints without a profile require reapproval.
If node-pty reports failed native resource drain after process exit, an action's close promise can
reject permanently. Once detached shutdown confirms the process tree is gone, persist a failed or
stopped terminal run with the drain error and release Host liveness; repeated Stop cannot repair the
already-settled drain promise. Keep the lease only when process-tree shutdown itself is unconfirmed.

The September 2026 native action verification reproduced a SQLite worker teardown abort on pristine
main with transitive better-sqlite3 12.11.1. Root and Effect SQLite now share 13.0.3, which includes the
upstream 13.0.2 worker-termination fix. Migration compatibility fixtures must create the historical
schema with a bounded migration list; creating today's tables and erasing later ledger entries
causes false duplicate-table failures as new non-idempotent migrations are added.

Providers speaking the OpenAI-completions shape (GLM via OpenRouter confirmed) silently return
tool-call `arguments: "{}"` for any tool whose parameter schema is a root-level `anyOf`/`oneOf`
union; flat object schemas work, including nested property unions and `action` literal-union
discriminators. First-class Pi tools must therefore register flat object schemas and enforce
per-action required fields and enums at run time (see `sessions-tool-flat-schema.ts`, PR #219 /
issue #218). When `pi.validateToolArguments` reports `Received arguments: {}`, suspect the
provider dropping arguments for the schema shape before blaming parsing or permissions; the
cheapest discriminator is a raw REST probe of the provider with the exact tool JSON.

Other providers reject a root union outright rather than dropping arguments. Pi 0.87 sends
`tool.parameters` verbatim unless strict constrained sampling is on, so a root `anyOf` reached
Bedrock as `toolConfig.tools.N.toolSpec.inputSchema.json` ("type must be one of: object" on the
first turn) and OpenAI via OpenRouter as "schema must be a JSON Schema of 'type: \"object\"', got
'type: \"None\"'" (gpt-4.1/gpt-4o-mini; gpt-5.x routes tolerated it). The culprit was
`preview_resize`, tool 8 after Pi's four built-ins and four earlier preview tools; every MCP
server in the user's config already served object roots. Every tool parameter root must be
`type: "object"` with no root `anyOf`/`oneOf`/`allOf`/`enum`/`not`/`const`/`$ref`.
`provider-tool-schemas.unit.test.ts` pushes every OpenWaggle tool through Pi's real Bedrock and
OpenAI-completions request builders (`onPayload` throws before the network) and checks that rule.
Third-party MCP schemas are repaired at the Pi adapter (`providerToolParameters`), and the server's
original schema still validates arguments before approval.
Pi also validates every call against the provider-facing schema (`validateToolArguments`) before
`execute`, then passes its cleaned output (optional `null`s dropped, `'5'` coerced to `5`) to
`execute`. A flattened repair kept as constraints was stricter than the server schema:
`patternProperties` in closed alternatives, hoisted `$ref`s into removed combinators (also from
`$defs`/`additionalProperties`), `unevaluatedProperties`, and requirements hoisted past a `true`
alternative all made Pi block valid calls before call-time validation ran. Even "loosening"
repairs can be stricter: a dropped `if`/`then` hides annotations `unevaluatedProperties`
relied on, a `$ref` can point into a dropped keyword, and a set root `type` reaches
`{$ref:'#'}`. So whenever the server schema compiles, direct tools register a relaxed repair
(`provider-tool-parameter-relaxation.ts`:
object root, `required` only for fields every accepted argument carries, annotations, and each
property as `{anyOf: [...definitions, {}]}`, with `{}` first when a definition holds a `$ref`,
`$dynamicRef` or `$recursiveRef`, because Pi compiles union members standalone and a reference
to `'#'` then recurses forever; local `$ref`s into a wrapped property are rebased to follow it).
Flattening resolves local `$ref`s against the document root, which misreads references inside
a nested `$id` resource and can hoist `required` fields the server does not demand, so when the
server schema has any nested `$id` the relaxed schema keeps only the root's own `required`. A permissive
schema also disables Pi's clean-up, so `execute` redoes it (`mcp-direct-tool-call-validation.ts`):
forward the first candidate the exact server validator accepts, trying Pi's cleaned output
against the server schema, then Pi's coercion through the unrelaxed flattened repair, then the
raw arguments. Pi's verdict is confirmed exactly because Pi bundles its own TypeBox (1.3.27 vs
the app's 1.3.32), and the copies disagree on edge cases such as the `iri` format and
`minLength` on graphemes. Direct tools whose server schema does not compile keep the unrelaxed
repair, because it is then the only check before approval. Sampling tools keep it too: Pi does
not validate their calls, so relaxing would only cost guidance. Flattening is bounded in depth
and total schemas, since `{anyOf: [{$ref:'#'}, ...]}` otherwise recurses or explodes. Such a
schema still compiles but overflows the stack on every exact `Check`; the validator reports that
as a readable violation, so the tool registers but every call is rejected before approval. When
relaxation drops a root `additionalProperties: false`, the description says only the listed
properties are accepted, unless `patternProperties` (also dropped) admit other names.

For managed-worktree cleanup, a retained preparation snapshot belongs to a directory generation,
not merely a project and worktree path. Pin the worktree directory's device, inode and birth time
when the checkout exists; a pre-birth snapshot gets its identity after materialization. If the
recorded generation is missing or differs at removal, do not execute its pinned cleanup command
in a replacement checkout. Explicit Delete anyway can still skip that cleanup.
Retained-preparation listing must include generation mismatches even when cleanup status is idle
or succeeded. Settings must keep Delete anyway visible for those rows and explain why Retry cannot
run the pinned cleanup in the replacement directory.

Workspace preparation review writes two durable records: the project catalog's remembered approval
and the pinned Workspace snapshot. If snapshot persistence fails after a catalog edit, restore the
exact previous catalog review using the resulting catalog revision; never leave a shared setup
enabled for later worktrees when the approval request reported failure. For POSIX Setup capture,
escaped prefixes such as `\command exec` and `\builtin exec` suppress alias expansion just as
`\exec` does, so normalize those executable forms outside quotes, comments and heredocs before
evaluating the command.
Prefixed `builtin eval` and `command eval` must pass through the same runtime rewrite as plain
`eval`; otherwise an escaped `exec` can replace Setup before its new exports are captured.
For custom PowerShell actions, preserve a failed native command's `$LASTEXITCODE` instead of
collapsing every final failure to exit 1; cmdlet-only failures still use 1. Pending-publication
details shown in Settings must omit canonical Workspace paths and use a relative recovery path.
An exact saved package task must be matched directly against declared Workspace patterns instead
of enumerating the 250-package discovery page; still reject excluded, generated, symlinked, and
missing sources. Match exact Workspace globs with fast-glob's micromatch semantics: Node
`path.matchesGlob` misses leading `./` patterns and directories named by `/**` exclusions.
Normalize discovered sources and test exact exclusions against each ancestor. PowerShell keeps a
native `$LASTEXITCODE` across later cmdlet failures, so use the
final user command's kind before applying that code to an action's final status.
Force removal with `skipCleanup` must skip Cleanup for every persisted status, including `idle`;
otherwise an arbitrary cleanup command can run despite the user's explicit skip confirmation.
The pinned Workspace snapshot owns Setup review decisions independently of the latest project
catalog. A disabled shared Setup is still reviewable in the Session UI; keep Run setup gated until
the user enables that snapshot version. When recreating a missing managed checkout, hold the same
Workspace action mutation fence as starts and removals, stop runs from the old directory generation,
then reset preparation and create Git state so a new launch cannot reuse the old process.
Git may refuse a dirty or locked worktree before Cleanup changes its idle state, so Settings must
offer an explicit Force remove path on a non-main worktree row even without retained preparation.
PowerShell `CommandAst.GetCommandName()` is empty for a final `& $exe` invocation; resolve a
variable command name from the current script scope before deciding whether its failure owns
`$LASTEXITCODE`. Setup capture needs the same final-statement distinction as custom actions so a
later failing cmdlet cannot inherit an earlier native exit code.
The call operator can also target an indexed command name such as `& $commands[0]`; classify the
selected command before using `$LASTEXITCODE`. POSIX heredoc delimiters are shell words, not
identifier tokens: strip their quotes and escapes in both the static and evaluated-command scanners,
including punctuation such as `<<'END.JSON'`, and queue multiple pending heredocs.
POSIX command-position scanners must keep valid `command --`, `command -p`, and Bash
`time -p` prefixes while finding escaped eval/exec; the Setup command alias must also dispatch
the option-prefixed eval through its capture wrapper, since the shell builtin `command`
cannot invoke the wrapper function. `command -p --` is a valid combined prefix, while
`command -- -p` is an end-of-options command operand and must not be rewritten.
Arithmetic left shifts inside `$((...))` expansions and `((...))` commands are not heredocs;
both static and runtime Setup scanners must skip those operators so a later escaped exec
remains capturable. Inline `name() {` and `function name {` bodies also begin a new command
list: an escaped eval immediately inside the brace must be captured at command position.
POSIX Setup capture can write an early snapshot while intercepting `eval`, `command`, or
`builtin`. A later command name expanded from a variable can become `exec` without alias
expansion and replace the shell before its success handler runs. Treat such snapshots as
provisional: accept an environment export only after the handler completes or a known
literal exec path marks the export verified. Reject a successful process exit with only
the provisional snapshot rather than silently persisting stale preparation values.
Shell feature tests must probe the actual shell executable. `/bin/sh` supports Bash
locale-quoted words on macOS but is dash on Ubuntu CI, where the same syntax exits 127.
Restart uses the current catalog action, since a retained run stores its historical
definition; submit the current execution key and let Host preflight catch edits that race
the restart. A saved task missing from a complete discovery result is unavailable in the
menu. Missing tasks in capped or diagnostic-bearing discovery remain undecided until a
direct launch resolves the reference.
PowerShell call-operator targets can be member expressions
such as `& $commands.main`; resolve only inert variable, constant, index, and note-property
AST shapes when classifying the final command, without reevaluating user code or borrowing an
earlier native exit for a final cmdlet failure.
PowerShell's `& ($commands[0])` wraps the indexed target in a `ParenExpressionAst` containing
one `PipelineAst` and one `CommandExpressionAst`. Unwrap only that inert shape recursively;
leave pipelines and expressions with command calls unresolved so failure classification never
reruns user code.
Interpolated call-operator targets such as `& "$exe"` use `ExpandableStringExpressionAst`.
Reconstruct only literal segments without PowerShell escapes and nested inert string expressions;
reject command-bearing subexpressions so inspecting a failed native command never repeats effects.
An `Env:` command target is also a `VariableExpressionAst`, but `Get-Variable` cannot read the
environment provider. Resolve only `Env:` drive-qualified paths through the process environment;
leave other provider drives unresolved rather than invoking arbitrary provider behavior.
Static and runtime escaped-eval scanners must preserve the enclosing command prefix while an
unquoted `$()` spans physical lines. Keep physical line starts for heredocs, but save and restore
command starts at matching substitution parentheses; otherwise `) \eval` as an ordinary
argument can be mistaken for a case-arm command boundary.
Terminal history removal methods already await their queued mutations and discard failures for
the removed keys. A global `flush()` afterward can report an unrelated terminal write failure
after a successful close; use a key-scoped flush for one terminal, and rely on completed owner
or path removal without a global failure check. Preserve global flush on all-terminal shutdown.

Action run output cursors cannot be recovered from retained log length after scrollback
compaction: the Host may flush the log before its throttled SQLite `outputBytes` update. Journal
the append or replacement text with its absolute end cursor in one private atomic sidecar before
writing the log; recover an unfinished journal idempotently, then commit the cursor. Failed
history batches, including ordinary PTY output, must be retried with the same journal before
later writes for that key; keep errors scoped to their history key so an unrelated terminal
failure cannot block a healthy action. If a crash loses an
unflushed tail that the renderer already displayed, keep the renderer's cursor stable rather than
clearing its output.
Action `readWithCursor` must return the retained bytes counted by that cursor. Ordinary terminal
replay scrubbing removes C0 controls such as backspace, BEL, and NUL, so applying it before action
pagination shifts the apparent retained start and can repeat output or falsely report truncation.
Keep replay scrubbing on the plain terminal `read` path.
Draft-terminal owner migration must use the move operation's pending-write barrier and check
failures only for source and destination owners. A global history flush can block first send in a
healthy project when an unrelated terminal has a persistent history-write failure.
When removing or truncating history, discard retry and failure state inside the serialized
mutation after earlier writes settle; an in-flight flush can otherwise recreate deleted history.

### A slow Host must not end the GUI's event stream (October 2026)

The GUI renderer bridge (`session-host-renderer-recovery.ts`) is the renderer's only source of
live Session events. It used to stop for good on any `retryable: false` protocol error, and the
Host's connection-level `fail()` marked every failure non-retryable, `handshake_timeout`
included. One Host stall of 5 s or more during a reconnect froze every Session until restart.
Both "subscription stopped after a terminal failure" lines in the beta.3 GUI logs were followed
by a user restart; the many recovered "degraded" retries were not. Now nothing stops the pump,
neither a watch nor an `ensure` failure: an older Host still reports `handshake_timeout` as
non-retryable from the `ensure` probe. After 10 consecutive failures it retries every 30 s and
logs one error; warnings are logged at attempts 1, 2, 4, 8, and so on. The backoff resets only
once a subscription delivers past its snapshot or stays up 10 s, so a fail-after-subscribe loop
cannot spin at 250 ms. `handshake_timeout` is retryable, and the Host-wide authentication throttle
reports `authentication_throttled` (retryable) instead of `authentication_failed`.
`LocalSessionHandshakeDeadline` re-arms when its timer fires late, at most 3 times, because after a
stall Node runs expired timers before it reads sockets and a buffered hello looked late, and it
gives a received hello one more period to authenticate. A caller whose authentication finishes
after the deadline expired is not admitted, or it would hold a client liveness owner forever.
`local-session-server-handshake-stall.integration.test.ts` reproduces these cases with a
busy-wait. Host and GUI both run `startEventLoopStallMonitor` (stalls of 1 s or more, at most one
log per 10 s, plus a trailing summary of folded stalls). The Host's report includes the oldest and
newest in-flight command names and liveness owners, so the next stall names its process. The stall source itself was not
reproduced. Measured against a 565 MB user DB copy: `persistSessionSnapshot` took at most 0.21 s
(7,929-node Session), `getSessionTree` 0.14 s, lexical search 0.37 s, and a WAL commit 30 ms under
heavy I/O, so SQLite work does not explain multi-second stalls. Pi's Bedrock tool-call streaming
reparses the whole partial JSON on every delta, which is quadratic: a 190 KB call costs 3 to 11 s
of CPU. The largest stored assistant message was only 38 KB, though. The pi-ai patch now rate-limits
that parse (`parseStreamingToolArguments` in `dist/utils/json-parse.js`, used by the delta paths
of Bedrock, Anthropic, OpenAI Responses/Azure/Codex, OpenAI Completions, Mistral and the
`pi-messages` client): every delta up to 8 KiB, then after 1/8 growth or max(50 ms, 10x the last
parse time). A block's `arguments` therefore lag its raw JSON, and every terminal path must parse
the full JSON itself: block stop, `done`, `error` and abort. Streams can end normally without
closing the tool block (Anthropic `message_stop` without `content_block_stop`, Responses
`response.completed` without `output_item.done`, Bedrock without `contentBlockStop`, pi-messages
`done` without `toolcall_end`); the first patch missed the Anthropic and Responses success paths,
so a `write` tool ran with 63,536 of 65,562 bytes. `finishStreamingToolCalls` now closes those
paths, and `pi-streaming-tool-arguments-terminal-paths.unit.test.ts` streams every patched
provider through a loopback server, ending normally without a close and failing after the
deltas, and checks the final arguments are exact. Any new provider path that pushes `done` or
`error` needs the same. A 217 KB call in 20-byte deltas
went from 14.5 s of parsing (10,884 parses, 4.5 s event-loop lag end to end) to 51 ms (436
parses, 48 ms lag). `pi-bedrock-streaming-tool-arguments.unit.test.ts` drives Pi's real Bedrock
stream against a loopback AWS event-stream server (`bedrock-event-stream.test-utils.ts`).
OpenWaggle's own projection copied the whole input into every `toolcall_delta` transport event,
and each copy is stringified for the Host socket, parsed by the GUI, cloned over IPC, and
re-stringified by the renderer: about 1.2 GB for that one call. `emitToolCallDeltaUpdate` now
emits a `toolcall_delta` only when Pi replaced the call's `arguments` object (a re-parse); held
raw deltas ride on the next emitted event, and the tail after the last re-parse is superseded by
`toolcall_end`'s exact input. That cut it to 436 events and 4 MB (renderer apply 830 ms -> 4 ms).
A Pi provider that mutated `arguments` in place would freeze the live preview until the call ends.

### A replace must not wait on its Run while holding the attachment transition

The Session Control dispatcher holds a Session's attachment transition for a whole non-interrupt
command. `replace` waits there for the interrupted Run to settle, and that Run's teardown
(`withRunAttachmentCleanup`) releases its attachments under the same transition before it
settles. Every replace of a live classic Run deadlocked: the Worker stayed `active`, the replacing
Queen's Sessions tool call never returned (the dispatch is uninterruptible), and GUI Stop on the
Queen waited on a Run that could not settle, so the renderer showed "Timed out waiting for the
Local Session Host" while the Host kept serving other Sessions. Host restart then recovered both
Runs as `interrupted-by-host-loss` and paused the Worker queue with `host-lost`.

The replacement now lends its transition to exactly the awaited Run
(`lendSessionAttachmentTransitionToSettlingRun`, borrower named by `settlingRunId`); every other
operation stays excluded. Explicit Waggle teardown runs `cleanupUnreferenced`, which would delete
the replacement's bound attachments, so it does not borrow: replacing a live explicit Waggle Run
can still deadlock. GUI/CLI `interrupt` now waits at most `RUN_INTERRUPTION_SETTLEMENT_WAIT_MS`
for settlement and then answers `interruption-requested`. The wait must be marked
`Effect.interruptible`, or the dispatcher's uninterruptible region makes the timeout wait too.

## Website documentation routing

The user guide starts at `/docs/getting-started/first-run` with the label **Get started**; `/docs` redirects there. `website/src/data/docs-nav.ts` separates user navigation from developer/package references without moving existing content URLs. Page frontmatter still supplies section/order to the installed-docs generator, independently of the website sidebar.

Unversioned package documentation URLs navigate immediately to their current versioned pages. Static Astro `302` redirects generate a two-second meta-refresh delay; use `PackageAliasRedirect.astro` for zero-delay navigation with a canonical URL and fallback link. Preserve the query and fragment with synchronous `location.replace`; meta refresh drops fragments. Keep a zero-delay `noscript` fallback for browsers without JavaScript. Rendering a versioned guide at its unversioned alias breaks relative links such as `./api-reference` and `./components`; keep the redirect when changing package versions. Verify built-page links, including fragment IDs, after navigation or heading changes.

Before a broad documentation refresh, fetch the agreed source branch and record its commit. Trace each workflow to current UI labels and runtime behavior rather than treating old docs as authority. If the maintainer cites an unmerged implementation, record that separate source revision and do not claim it already ships on main. Model storage in the global app database can still be keyed by project; storage location and selection scope are different.

Published package API pages can intentionally lag unreleased source when `website/src/content/package-docs-next/<package>/` exists. `package-docs:check` preserves that release boundary; `api:snapshot:check` checks current exports. Correct authored prose and regenerate package READMEs with `package-docs:update`, but do not hand-backport unreleased symbols into frozen API inventories.

## Website landing and SEO

Pages build to `<route>/index.html`, so Cloudflare Pages serves `/docs/x/` and answers `/docs/x` with a `308`. Internal links must use the trailing-slash URL: `rehypeTrailingSlashLinks` rewrites Markdown/MDX links, `docsPath()`/`canonicalDocsPath()` build component links, and a source-scan test fails on slash-less hard-coded `href`s. Do not switch to `build.format: 'file'` to avoid this: versioned package routes such as `/docs/packages/pi-waggle/0.1` would look like file extensions to the host. Package nav slugs are noindex aliases; link and list them through `canonicalDocsPath()`, and keep redirect-only routes out of the sitemap (`website/src/lib/sitemap.ts`).

SEO metadata lives in `website/src/lib/seo.ts`. Every page emits one JSON-LD `@graph`; pages that reference the Organization or WebSite by `@id` must also define them. The default Open Graph image is `website/public/og/openwaggle.png` (1200x630), rendered from an HTML template with the logo assets; og image dimensions are emitted only for that image. `/llms.txt` indexes the docs for AI assistants.

The app repository has no LICENSE file (only the npm packages declare MIT), so the website must not call the app "open source" until one is added; a test guards the JSON-LD and default description. `logo-wordmark.svg` and `logo-lockup.svg` draw the name with SVG `<text>` in Clash Display plus a hard-coded `dx`; inside `<img>` the web font never loads, so the system fallback renders it, with "n" and "W" touching. Converting the text to outlines is the fix if the rendering must be stable.

## Usage statistics notice

The user-facing notice for Usage statistics and error reports is `website/src/content/docs/configuration/usage-statistics.md` (Help > Usage statistics). It restates `docs/specs/usage-statistics-fields.md` and `src/shared/usage-statistics/contract.ts`, so change all three together. Its storage, delivery and error-report sections also mirror `functions/_lib/` (`buffer-entry.ts`, the `flush-*.ts` files, `request-shape.ts`, `request-log.ts`, `visitor-key.ts`), `src/main/usage-statistics/usage-statistics-reporter.ts` and `src/shared/error-reporting/error-report-rules.ts`; a behaviour change there needs the same change on the page. ADR 0046 ships no in-app prompt, so the notice must stay linked from `security-privacy.md`, `installation.md`, the README, the Settings switch, and `openwaggle --help`. Its controller name and retention periods are filled in (controller Diego Garcia Brisa in person; PostHog free 1 year, Sentry free Developer 30 days, Cloudflare security events 31 days). Change them when the controller becomes a company or a plan changes, and re-sign the PostHog and Sentry DPAs in the new controller's name.

Sentry derives `user.geo` (city, region, country) from the sending address even with **Prevent storing of IP addresses** on, and an explicit `user.ip_address: null` does not stop it; verified October 2026. Behind the endpoint that address is Cloudflare's edge near the user, so the `openwaggle` project carries an Advanced Data Scrubbing rule removing `$user.geo.**`. A new project needs it again; it takes a few minutes to propagate.

A long `pnpm verify` pre-push (about 5 minutes) can outlast GitHub's idle SSH connection: the hook passes and `git push` then exits 141 without pushing. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, then confirm with `git ls-remote`.

The page also describes Pi's own provider headers, so recheck them on every Pi upgrade. In Pi 0.87.1, `getDefaultAttributionHeaders` adds OpenRouter `HTTP-Referer: https://pi.dev`, `X-OpenRouter-Title: pi` and `X-OpenRouter-Categories: cli-agent`, NVIDIA `X-BILLING-INVOKE-ORIGIN: Pi`, and Cloudflare `User-Agent: pi-coding-agent`, all gated by Pi's `enableInstallTelemetry` setting (default on) or `PI_TELEMETRY`, which takes precedence and counts only `1`, `true`, or `yes` as on. `getSessionHeaders` always sends opencode providers `x-opencode-session: <Pi session id>` and `x-opencode-client: pi`. Pi's `pi.dev/api/report-install` ping and `pi.dev/api/latest-version` check run only in Pi's interactive TUI and package-manager CLI, which OpenWaggle never starts. `provider-attribution-extension.ts` rewrites only those exact Pi values, so a Pi upgrade that changes one silently stops the rewrite for that header and makes the notice's provider table wrong.

## Error reports (Sentry) and provider attribution

`@sentry/electron` is a devDependency bundled into main, preload and a lazy renderer chunk (`sentry-renderer-*.js`, outside the initial graph); `@sentry/core` is a devDependency only so `sentry-gated-transport.unit.test.ts` can run the real SDK client. The vendor code lives only in `src/main/adapters/error-reporting/`, `src/preload/error-reporting-bridge.ts` and `src/renderer/src/shared/lib/sentry-renderer.ts`; the port is `src/main/ports/error-reporter.ts`. Every SDK uses `defaultIntegrations: false` with an explicit list, because the defaults include release-health sessions, minidump upload, breadcrumbs, screenshots and context the notice rules out, and the SDK's `childProcessIntegration` instruments every Node child process and worker and reports errors the app handles; `processExitIntegration` reports only Electron `child-process-gone`/`render-process-gone`. The main transport (`sentry-gated-transport.ts`) also strips every envelope item that is not an `event`, and every event that main's own `beforeSend` did not scrub, tracked in a `WeakSet` of event objects. The SDK hands some renderer envelopes straight to the transport, such as one whose last event item has an empty payload, and Sentry core keeps the `beforeSend` object identity through to the envelope (the real-client test covers this). The renderer reaches main over `hookupIpc()` from `@sentry/electron/preload-namespaced` with `ipcMode: IPCMode.Classic`, so the CSP needs no new source.

`src/main/error-reporting.ts` starts the SDK only after Settings load (GUI: after `hydrateSettingsStoreFromHost`, awaited before the main window opens; Host: after `initializeSettingsStore`), never under a fixed opt-out (`dev-build`, `automation`, `do-not-track`, `pi-telemetry`, `ci`), and while the Setting is off only subscribes and starts when it turns on. It imports the enablement module lazily, because that module imports `store/settings` at load and the GUI startup path imports settings late. Main passes `--openwaggle-error-reporting` in `additionalArguments` unless a fixed opt-out applies or its SDK failed to start, even while the Setting is off: the switch is fixed when a window opens, so this is what lets a user who turns statistics on mid-session get renderer reports from the open window. Without it the preload exposes no bridge. With it, `src/renderer/src/window-error-reporting.ts` starts the renderer SDK, at the next idle moment, only once the window's preferences store has loaded Settings without an error and `usageStatisticsEnabled` is on, now or later; until then the chunk never loads, and errors reported meanwhile are dropped, not held.

The scrubbing rules live in `src/shared/error-reporting/error-report-rules.ts`, which imports only the constants and no alias so the statistics endpoint can bundle it. Only a handled error reported with the `application` origin keeps message text, and no call site passes it yet; everything else, unhandled errors (tagged `unhandled`), tool and provider errors and the fatal startup reports included, keeps only type and code. The text rules skip `event_id`, `release` and `dist`, since a 32-hex event id would become `<hex>`. Stack frames (`filename`, `abs_path`) and `debug_meta` images (`code_file`, `debug_file`) outside the app's own code become `<external>` (or `<external>/index.js` and the like, since an entry module's name says nothing), and those frames' `function` and `raw_function` become `<external>` and they lose `module`; an exception keeps its `type` only if it is a built-in error type (`ERROR_REPORT_BUILT_IN_ERROR_TYPES`) or its last frame, the thrower, is app or Node.js code, otherwise `Error`. Only `app:///` (the SDK's normalized app path), `node:`, the renderer origin `openwaggle://app/` (a src/main test pins it to `RENDERER_PROTOCOL_ORIGIN`) and native or pseudo locations (`native`, `<anonymous>`, `<data:…>`, `index 0`) count as own code; `<external>` itself stays external, so the rules are idempotent. Pi extensions and worktree code run in the Session Host and are named by their authors, so folders, file names, function names and error classes would otherwise name private projects in every report from an install. The rules live in `error-report-code-rules.ts`, re-exported by `error-report-rules.ts`; the renderer applies them too, since they are structural, and `functions/_lib/sentry-scrub.ts` applies them again. The renderer skips the text rules (`scrubText: false`) because main re-scrubs renderer events with the real home directory. The `openwaggle.error_origin` tag is trusted only from the main adapter's own `captureException` hint (`data.openwaggleReportedOrigin`); `beforeSend` deletes any other value, because scope tags reach every report and the preload bridge's `sendScope` lets a page script set them. The adapter also removes the SDK's `sentry-ipc.scope` IPC listener after `init`, since OpenWaggle's renderer leaves out the scope-to-main integration, and a unit test pins that channel name to the SDK's own naming. The endpoint reads the tag through `keepsErrorReportMessageText`, so it relies on the app having written it.

OpenWaggle's Pi settings storage reports `enableInstallTelemetry: true` in memory only (`openwaggle-pi-settings-install-telemetry.ts`, writing the stored key back in place), and `provider-attribution-extension.ts`, loaded into every Pi runtime by `pi-provider-resources.ts` (automation included, since inline factories load despite `noExtensions`), rewrites Pi's exact attribution values per request: OpenWaggle labels while statistics are on, removal while off. A registered `before_provider_headers` handler makes Pi keep the prepared Native compaction auth (`preserveCompactionAuth`); `provider-attribution-native-compaction.integration.test.ts` covers automatic Native compaction with it. MCP sampling calls pi-ai `complete()` directly, so those requests never pass the handler and carry no attribution labels.

Adding a dependency with `pnpm add` runs the root `postinstall` (`electron-builder install-app-deps`), which rebuilds native modules for Electron in the shared checkout and can fail half way on node-pty; pass `--ignore-scripts` and run `pnpm prepare:native:node` or `prepare:native:electron` deliberately instead.

## Usage statistics recorder and reporter

App-side Usage statistics live in `src/main/usage-statistics/` (infrastructure: process-global recorder state, files, timers) behind the `UsageStatisticsRecorder` port; the boundary lint stops application, IPC, store and domain code from importing that directory, and stops it importing application or IPC code. Adapters, including the Pi adapter, may call it directly. Each process owns one file under `<userData>/usage-statistics/`: the Session Host `host-state.json`, the GUI `gui-observations.json`. Only the Host sends; it merges the GUI's file into a day when that day is complete, then closes the day.

Days are closed one by one, not with a high-water mark: `closedDays` is bounded by count (72, oldest dropped first), never by a date window, because a clock that ran ahead would otherwise age out days the GUI file still holds; `closedThroughDay` is a floor only a corrupt-file reset sets. Delivery is at most once: a batch is sent only after its day is on disk as `inFlightDay`. A marker write that fails is rolled back in memory and the day waits; the reporter abandons a marker only once, when it starts, because only a previous Host can have left one, and closes that day unsent. Only a 5xx or 429 answer, or a connect-phase failure (DNS, refused, unreachable, connect timeout), keeps a day for a retry; a timeout, reset, transport defect or other failure is an unknown outcome and closes it. Existing installs are not counted as new at rollout: the reporter reads the oldest Session `created_at` and the first `_migrations.applied_at` (a missing table is no evidence), and evidence more than 10 minutes before the first recorded day marks `install.new` and onboarding as sent and starts the install age there. While that read fails the reporter sends nothing; after three failed reads it treats the evidence as absent.

In an attached GUI the settings store's own database is an empty `:memory:` one, so its defaults (statistics on) must never count: `store/authoritative-settings.ts` publishes only a Host-hydrated snapshot in client-isolated mode, and `usage-statistics-enablement.ts` subscribes to it. Provider, model, MCP and skill identifiers come from `src/shared/usage-statistics/catalog.generated.ts`, the same file the endpoint enforces.
