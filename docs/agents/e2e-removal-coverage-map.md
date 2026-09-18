# E2E removal — coverage-conversion map

ADR 0033 removes the Electron E2E suite and moves per-PR gating onto unit +
integration + MCP conformance, mirroring `pingdotgg/t3code` (which has no E2E at
all). This maps each removed E2E spec to where its behavior is (or is not)
covered, so the coverage trade is explicit.

The finding: the E2E suite was almost entirely **belt-and-suspenders** over
existing unit/integration/component tests. Topic coverage already present in
`src/**/__tests__` (file counts): terminal 177, waggle 344, extension 187, diff
115, workspace 95, browser-preview 72, compaction 70, transcript 52, scroll 40,
visualization 40, appearance 39, tool-call 33, project-draft 14, inspector 9,
thread 6, session-branch 5, access-mode 4.

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
| visual-regression | pixel baselines of six surfaces in a real renderer | none in CI; run `--update-snapshots` locally when doing UI work |
| security-csp | CSP actually blocking inline script in the Electron renderer | manual QA; CSP headers unit-checked in `electron-security` |
| diff-performance / terminal-performance / workspace-editor (timing budgets) | wall-clock budgets on the main thread in the packaged app (the *logic* — off-main-thread parsing — is unit-covered; only the timing budget is E2E-only) | nightly packaged canary + local perf runs |
| inline-visualization (isolated frame lifecycle) | real isolated Electron `<iframe>` teardown/limits | nightly packaged canary |
| app (real boot) | the packaged app actually launching main+renderer+preload | nightly packaged canary (`packaged-app:smoke` on macOS/Linux/Windows) |

## Net

No functional behavior is lost from the merge gate: it was already unit/integration
covered. The genuinely E2E-only guarantees (real boot, packaged native runtime,
CSP, visual, timing) are now caught by the **nightly cross-OS packaged canary**
(`.github/workflows/nightly.yml`) as a non-blocking signal, plus local runs — not
by a flaky 3-OS suite gating every merge.
