# MEMORY.md

Durable OpenWaggle project memory. Keep this compact and technical. Do not add personal/cross-repo agent preferences here.

## Active Warnings

- The working tree may contain another agent's active refactor. Treat dirty files as intended future shape unless there is clear evidence otherwise.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed. Add durable OpenWaggle memory here or to focused skills.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not manually scaffold it during unrelated work.

## Current Architecture Direction

- OpenWaggle is an Electron desktop coding-agent UI on top of Pi.
- Main-process architecture is hexagonal: domain, ports, adapters, application services, IPC, stores.
- Pi SDK imports belong in `src/main/adapters/pi/` only.
- Provider/model/auth metadata must mirror Pi through `ModelRuntime`, project-scoped runtime services, and OpenWaggle-owned ports.
- OpenWaggle must not maintain a parallel `src/main/providers/` registry.
- OpenWaggle extension UI direction is ADR-0006: model visual contributions as surface/runtime/execution, default to a framework-neutral federated-module runtime with `mount(context)`, and do not expand placeholder route/content experiments as a parallel legacy runtime.

## Pi Runtime Memory

Load `.agents/skills/pi-integration/SKILL.md` for details.

- Pi JSONL sessions are runtime state; SQLite session projection is the product read model for renderer navigation, branching, persistence, active runs, and UI state.
- Pi-native tool events, thinking levels, compaction behavior, session ids, provider/model ids, and auth methods should stay Pi-native through the adapter boundary.
- Missing projected Pi entries during clean-cut projection rebuilds should be treated as stale/cancelled navigation, not thrown through IPC.
- Preserve Pi-created session ids before first prompt by opening the pre-created id correctly instead of allowing a missing JSONL path to create a different id.
- Build runtime services through Pi's project-scoped service path so extensions/providers are registered before model resolution.
- Pi package extension loading must be scoped to the active project and adapter cwd so package extensions do not read Electron's process cwd or leak server processes.
- OpenWaggle masks user-managed `pi-mcp-adapter` npm entries from its embedded Pi SettingsManager at read time and restores them on writes; never uninstall or remove those shared entries because standalone Pi and other projects may still use them.
- OpenWaggle-owned Pi extension packages must be bundled/copied locally and `asarUnpack`ed for packaged apps.
- Pi-native Waggle state belongs to `@openwaggle/pi-waggle`: runtime custom message/state types use the `pi-waggle.*` namespace, branch mode/config is stored as `pi-waggle.mode-state` custom entries, and OpenWaggle should project metadata from those entries instead of seeding a parallel metadata tree.
- Pi TUI Waggle continuation turns should be scheduled after the current Pi run settles, then append the visible `pi-waggle.turn` custom message and call `sendUserMessage(...)` without `deliverAs`; queuing continuation prompts with `deliverAs: 'followUp'` during `turn_end` can leave them waiting for user confirmation. Accumulate tool-call turns with their `toolResults` before advancing, and use `agent_end` only as a fallback for pending tool-call-only completions.
- User-authored input during an active Pi TUI Waggle run must stop automatic Waggle continuation and be resent with `sendUserMessage(..., { deliverAs: 'steer' })`; otherwise Pi rejects it with “Agent is already processing” because normal prompts during streaming need an explicit streaming behavior.
- Pi custom TUI components must use `@earendil-works/pi-tui` keyboard helpers such as `matchesKey`/`parseKey` instead of raw escape-sequence comparisons; Kitty keyboard protocol encodes Enter, Esc, Space, and Ctrl+C as CSI-u sequences, so raw checks can trap users inside custom menus.
- Pi custom TUI components must never return strings containing embedded `\n`/`\r`; normalize dynamic labels/details to single terminal lines before rendering. They must also truncate rendered lines with `truncateToWidth`/`visibleWidth`, not string length, clamp scroll windows to `items.length - visibleRows`, and reserve fixed blank slots for scrollable lists/details. Embedded newlines, overflowing lines, or shrinking terminal output can corrupt Pi TUI's differential cursor math and leave duplicated-looking rows. Prefer Pi's built-in `ctx.ui.select` for modal menus unless custom rendering is clearly needed, so the Pi footer/status remains visible and interaction steps do not visually jump.

## MCP Runtime Memory

- MCP is an OpenWaggle-owned runtime capability, not a Pi extension. Keep protocol lifecycle, configuration, transport, trust, authentication, capability discovery, and server hosting behind OpenWaggle ports/adapters; Pi receives only the compact gateway tools for an active turn.
- MCP activation resolves session → project → global and defaults off globally. Disabled servers must not connect, inject instructions/capabilities, or remain attached after the safe turn boundary; the UI must distinguish desired, applied, and pending state.
- Interoperate with current MCP (`2026-07-28`) and the supported legacy revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`) across both client and hosted-server paths. Preserve protocol/transport negotiation diagnostics instead of silently dropping older servers.
- Treat remote MCP content as untrusted: require explicit trust and capability opt-ins, keep Event Inbox and server instructions out of context until reviewed, sandbox MCP Apps, isolate sampling, keep roots read-only, validate Remote Skills, and surface every required user or agent follow-up as a durable notice.

## Electron Runtime Memory

Load `.agents/skills/electron-runtime/SKILL.md` for details.

- Native addons have separate Node and Electron ABI targets. Rebuild with the repo scripts before blaming app code.
- Packaged apps may not inherit a shell PATH. Pi package/resource loading and Pi-run child processes that shell out to tools need an adapter-controlled npm-compatible PATH, including common user tool dirs such as `~/Library/pnpm` on macOS.
- `electron-builder` with pnpm can omit transitive runtime modules unless explicit dependencies are present; `ms` is intentionally explicit for `electron-updater`.
- macOS `electron-updater` requires ZIP artifacts in GitHub release metadata; DMG-only mac releases can advertise an update but fail with "ZIP file not provided".
- On Apple silicon, performance/package QA should use arm64 outputs, not Rosetta x64 output from a universal build folder.
- Electron Playwright E2E requires isolated user data and single-instance lock opt-out when another OpenWaggle instance is running.
- CDP file upload can produce `File` objects without native paths; native file-path behavior needs preload/unit coverage or real OS selection QA.
- **The Windows NSIS script is only compiled when electron-builder packages Windows, which happens in the release workflow, not CI.** An installer-variant StrFunc call inside `customUnInstall` broke two consecutive releases across six days before anyone noticed, because NSIS only rejects it at compile time. `build/installer.nsh` is now compile-checked by `pnpm check:installer` inside `pnpm check`, so it fails a pull request in seconds instead of a release in minutes. Two NSIS rules worth remembering: StrFunc helpers must be declared before use, and an uninstall section can only Call `un.`-prefixed functions, so `customUnInstall` needs the `Un` variants (`${UnStrRep}`, not `${StrRep}`).

## Renderer And Session Memory

- Renderer state that represents chat transcripts or active runs must be keyed by concrete `SessionId`, not only the active route.
- Switching away from a foreground run should demote it to background state, not reject the send promise as an error.
- Active-run UI continuity needs a renderer-owned render snapshot keyed by session id; persisted run metadata alone does not prove visible reasoning/tool rows remain continuous.
- First-message sends must bind to the concrete newly created session before async send begins; do not enqueue by current active session after users can switch projects.
- Session tree/header refreshes for background sessions must not overwrite the active session tree/header.
- Session-native transcript rendering reads from the active `SessionWorkspace.transcriptPath`; preserve live tails only at active branch head.
- TanStack Router uses hash history in Electron QA; navigate to `http://localhost:5173/#/<route>`.
- TanStack Hotkeys same-target callbacks do not stop each other via `event.stopPropagation`; independent overlays need explicit topmost ordering.
- Composer slash selection is owned by Lexical: keep focus in the editor, derive the active `/query` from its collapsed selection, replace or consume only that token, and serialize skill decorator nodes as `/skill-id`. Do not route `/` through a second-input global palette.
- Waggle presets in the desktop composer are one-shot invocation metadata, not idle global mode state. A standard agent hands off through the terminating `waggle_invoke` Pi tool, and the main handler chains Waggle only after the standard result is durable.
- Workspace file UI is route-backed, but all indexing, root confinement, preview reads, optimistic-revision writes, and external-open resolution stay behind `WorkspaceFileService` in the main process.
- **React Compiler runs in the app build (`electron.vite.config.ts` -> `reactCompilerPreset()`) and, since this work, in the component test config too — but not in the node unit config, which renders nothing.** Any component that reads render data from a library-owned *mutable* instance can pass a suite that does not run the compiler and still render permanently stale in the real app: the compiler memoizes on referential identity, and the instance is mutated in place so its identity never changes. Hit for real with `@headless-tree` in the Changed-file navigator — `tree.getItems()` returned 262 items while zero rows reached the DOM. Fix is the scoped `'use no memo'` directive on the component that maps the mutable instance (an official compiler escape hatch, not a lint-ignore comment). See "The React Compiler now runs in component tests" below for the mechanism that now catches this class; for anything outside component tests, still treat a green suite as no evidence and verify in real Electron over CDP.
- Corollary: prefer libraries whose render input is a plain value over ones exposing a mutable instance, precisely because our tests cannot see the difference.

## Product And UX Memory

- Pi-native sidebar navigation is Projects-only. Do not add a global projectless Chats section.
- Waggle mode must run inside Pi as extension/runtime behavior, not as an OpenWaggle application loop that calls Pi once per agent turn.
- Waggle currently supports exactly two agents. Third-agent JSON edits must be rejected at core, Pi extension, shared schema, store schema, and application-service boundaries until N-agent turn policy, prompts, consensus, and UI are implemented first-class.
- Waggle and standard mode share session, branch, draft, archive, transcript, active-run, composer, settings, diff, and git semantics unless Pi imposes a narrow technical constraint.
- Composer branch/config changes are branch-scoped; child branches inherit parent config by default.
- Manual compaction mirrors Pi TUI slash-command UX: `/compact` and `/compact <custom instructions>`, not context-meter-triggered compaction.
- Provider auth UI is method-based. Keep provider-level availability separate from API-key configured state and OAuth connected state.
- Compact composer interactions stay in-row unless the maintainer explicitly asks for a larger workflow.
- Sidebar session rows are two lines at 316px width: the title owns line one, line two carries a shrinkable lead (state, phase, provenance) and a fixed tail (shortcut, timestamp). The timestamp never hides on hover; row actions overlay line one instead, because hiding it re-flowed the row under the cursor and removed information at the moment of acting on it.
- Status colour is a semantic role, never a palette class or a status-prefixed token (ADR 0021). Adding a state means naming a role, not reaching for `text-red-500`.
- The sidebar's `@theme` block must stay `@theme static`. Tailwind tree-shakes theme variables no utility references, and roles read at runtime through `var()` in inline styles (`--color-neutral`, `--color-review`, `--color-plan`) silently vanish otherwise.
- Do not show a count of uncommitted files on a session row. Every session sharing a working tree reports the same number, so it says nothing about the session, and a large number implies a severity it does not carry. Divergence (`↑n ↓n`) is the useful part.
- Provenance icons are a separate family from status icons and share no glyph with them (ADR 0020). At the size line two renders, a user reads silhouette rather than detail, so two node-graph glyphs are the same glyph.
- Sidebar view preferences (session sort, collapsed projects) persist; sidebar filters (state chip, text query) do not. A filter that subtracts sessions must not outlive the intent behind it.
- A list passed to `useSessionGitIndicators` must keep reference identity when nothing changed. The hook memoises on the array, so a freshly filtered copy every render re-runs its effect every render and spins the renderer.

## Tooling Memory

- Package manager: `pnpm`.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are the target strictness posture, but enabling them in build or lint tsconfigs requires a dedicated source-modeling pass across the active Pi/session refactor; lint-only enablement can create TypeScript `error` types that surface as noisy Oxlint `typescript/no-unsafe-*` diagnostics.
- TypeScript 7 uses Oxlint with tsgolint for type-aware TypeScript rules. ESLint remains for repository-specific, TanStack, and import-cycle rules; transitive `@typescript-eslint/*` utilities come from those third-party plugins and are not OpenWaggle's TypeScript parser.
- Unit, integration, and component tests belong in nearby `__tests__/`; E2E stays under `e2e/`.
- Do not suppress Fallow complexity findings; refactor instead.
- Do not add legacy compatibility for removed pre-Pi surfaces unless explicitly requested.

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

`npx playwright test` does not build. Running it directly tests the previous `out/`, which produces failures that look like broken source. Use `pnpm test:e2e`, or run `pnpm build` first.

The dev server rewrites `src/renderer/src/routeTree.gen.ts` (import ordering only, no route change). Any script that checks out commits in sequence fails on every checkout while that file is dirty. Stop the dev server before such a loop.
