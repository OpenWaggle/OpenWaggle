# E2E removal — coverage-conversion map

ADR 0033 removes the Electron E2E suite and moves per-PR gating onto unit +
integration + MCP conformance, mirroring `pingdotgg/t3code` (which has no E2E at
all). This maps each removed E2E spec to where its behavior is (or is not)
covered, so the coverage trade is explicit.

The finding: the E2E suite was almost entirely **belt-and-suspenders** over
existing unit/integration/component tests. Every removed spec's functional topic
has substantial existing coverage under `src/**/__tests__` (terminal, waggle,
extension, diff, workspace, browser-preview, compaction, transcript, scroll,
visualization, appearance, tool-call, project-draft, inspector, thread,
session-branch, access-mode all have dedicated unit/integration/component tests).

## Already covered by unit/integration/component — no conversion needed

| Removed E2E spec | Existing coverage lives in |
|---|---|
| access-modes | composer/access-mode `__tests__` |
| appearance | appearance/theme + settings `__tests__` |
| auto-attach | composer `useAutoTextAttachment` / `checkAndConvertPaste` via composer + useAgentChat utils tests |
| browser-preview-owner-navigation | `src/main/__tests__/browser-preview-*` + shell owner tests |
| compaction-settings | store `settings-compaction.integration` + compaction unit tests |
| inspector-panels | inspector/route sidebar `__tests__` |
| project-draft-session | project-actions + session draft `__tests__` |
| scroll-to-user-message | scroll/transcript anchor `__tests__` |
| session-branch-draft | session branch resolution `__tests__` |
| sidebar-filters / sidebar-remodel | shell ui-store + sidebar `__tests__` |
| thread-navigation | chat-store + session projection `__tests__` |
| tool-call-rendering | tool-call rendering `__tests__` |
| transcript-window | transcript windowing `__tests__` |
| waggle-streaming-rendering | pi-waggle turn-capture `__tests__` (344 files) |
| terminal-session / terminal-startup-input | terminal adapter `__tests__` (177 files) |
| extension-host | extension runtime/storage `__tests__` (187 files) |
| workspace-editor (behavioral) | syntax/workspace file service `__tests__` |
| app (settings migration, thread persist) | settings migration + store integration `__tests__` |

Where a specific assertion has no direct unit analogue, it is a thin add on top
of the modules above rather than a new suite.

## E2E-only — cannot convert; consciously dropped, compensated by the nightly canary

These assert properties that only exist in the real packaged/rendered app:

| Removed E2E spec | Why it cannot become unit/integration | Compensating control |
|---|---|---|
| visual-regression | pixel baselines of six surfaces in a real renderer | **none** — dropped from CI; verify locally when doing UI work |
| security-csp | CSP actually blocking inline script in the Electron renderer | **none in CI** for enforcement; CSP headers are unit-checked in `electron-security`; manual QA otherwise |
| diff-performance / terminal-performance / workspace-editor (timing budgets) | wall-clock budgets on the main thread in the packaged app (the *logic* — e.g. off-main-thread parsing — is unit-covered; only the timing budget is E2E-only) | **none in CI** for the app timing budgets (local perf runs only). The renderer **syntax** performance budget runs in the nightly canary. |
| inline-visualization (isolated frame lifecycle) | real isolated Electron `<iframe>` teardown/limits | **none** — dropped from CI; manual QA |
| app (real boot) | the packaged app actually launching main+renderer+preload | **partial** — the nightly canary proves the packaged app builds and its native runtime loads (`packaged-app:smoke` runs the binary as Node via `ELECTRON_RUN_AS_NODE`); it does **not** launch a window (no main+renderer+preload boot) |

## Net

No functional behavior is lost from the merge gate: it was already unit/integration
covered. The only guarantees dropped are genuinely E2E-only. Of those, the nightly
cross-OS packaged canary (`.github/workflows/nightly.yml`) covers exactly two:
**the packaged app builds** and **its native runtime (node-pty/sqlite) loads** on
macOS/Linux/Windows, plus the **renderer syntax performance budget** on macOS. It
does not launch a window, so **renderer boot, CSP enforcement, visual pixels, and
app timing budgets have no automated control** after this change — validate them
locally/manually when a change touches them. This is the deliberate trade: no flaky
3-OS E2E gating every merge, in exchange for those checks moving off CI.
