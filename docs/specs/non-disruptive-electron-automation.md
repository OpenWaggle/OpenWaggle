# Non-disruptive Electron automation

## Status

Implemented and verified on macOS with Electron 43.2.0 and Playwright 1.61.1.

## Problem

OpenWaggle's current `headless` Playwright setting does not control windows launched through Playwright's Electron API. The application creates its `BrowserWindow` with `show: false`, then calls `show()` after `ready-to-show`. On macOS that activates OpenWaggle and can switch applications or Spaces while someone is presenting or working elsewhere.

Agent QA also starts `pnpm dev:debug` against the normal development profile and CDP port 9222. A concurrent instance or occupied port can focus an existing OpenWaggle window, attach QA to the wrong process, or let automation modify real sessions and settings.

## Contract

Every scripted Electron launch is non-disruptive by default. Automated Electron must not:

- show or focus a `BrowserWindow`;
- activate OpenWaggle or expose its Dock or application-menu UI on macOS;
- open a native dialog;
- launch an external application or path;
- attach to an unknown process that already owns the expected CDP port;
- read or write the normal development profile.

An attempted OS-visible action fails instead of falling back to visible UI.

Visible Electron automation requires an explicitly headed command. An agent may run a headed command only after the maintainer approves that exact run.

## Launch behavior

| Path | Visibility | Profile | CDP | Notes |
|---|---|---|---|---|
| `pnpm dev` | Visible | Normal development profile | None by default | Ordinary interactive development |
| `pnpm dev:debug` | Hidden | Ephemeral | Reserved port 9223 | Managed agent-QA launcher |
| `pnpm dev:debug:headed` | Visible | Normal development profile | Port 9222 | Exact-run maintainer approval required for agents |
| Headless Electron E2E | Hidden | Ephemeral per app | Playwright-managed | Default E2E path |
| Headed Electron E2E | Visible | Ephemeral per app | Playwright-managed | Exact-run maintainer approval required for agents |
| Startup measurement | Hidden | Ephemeral | Dynamically allocated by its measurement harness | Scripted automation |
| Website screenshot capture | Hidden | Ephemeral | Playwright-managed | Hidden rendering still produces screenshots |

The hidden QA profile selects the current worktree as its project and starts with no fabricated sessions. A feature-specific test or QA script seeds only the deterministic data it needs.

## Managed hidden QA

`pnpm dev:debug` owns the complete QA lifecycle:

1. Check that port 9223 is free. Fail before Electron starts if it is occupied.
2. Serialize lease recovery and acquisition across launcher processes.
3. Create an ephemeral user-data directory and per-run automation identity.
4. Start Electron with a minimal allowlisted environment, automation mode enabled, and the single-instance lock disabled.
5. Wait for CDP, the preload bridge, and the matching automation identity before accepting the page.
6. Register the current worktree as the selected project and forward Electron logs while QA runs.
7. On child exit, `SIGINT`, or `SIGTERM`, attempt evidence capture and always continue through connection and process-tree cleanup.
8. Remove the ephemeral profile only after the Electron process tree has stopped. Windows uses `taskkill /T /F`; POSIX uses the detached process group.
9. On startup, quarantine and discard stale launcher metadata only when its recorded process is dead.

The Electron DevTools MCP configuration connects to `127.0.0.1:9223`. Dynamic port switching is outside this design because the connector binds its browser URL when the MCP server starts. Port 9223 is exclusive, so simultaneous hidden CDP QA sessions fail fast rather than share or silently switch ports. A per-run identity in the renderer URL prevents the launcher from accepting another OpenWaggle process if a process binds the port between preflight and Electron startup.

## Main-process enforcement

Automation mode is explicit. It is not inferred from `CI`, a Playwright configuration value, or the presence of a debugging port.

The main process owns the non-disruption policy:

- `ready-to-show` records readiness but does not show the window in automation mode;
- every `BrowserWindow` and `BaseWindow` construction is confined to policy helpers that force
  `show: false`, and direct reveal methods fail at runtime;
- macOS automation does not expose Dock or application-menu UI;
- native dialog APIs fail by default unless a test installs a deterministic response;
- external URL and path launch APIs fail;
- trusted-main and Pi runtime extensions do not load during automation because their unrestricted
  Electron access sits outside the repository's static window-construction boundary;
- visible window actions stay behind the centralized policy;
- Playwright's headed setting is translated explicitly into the Electron launch mode.

Repository standards reject new unguarded window-show/focus, native-dialog, and external-application call sites outside the policy boundary.

## Verification

Regression coverage must prove:

- a hidden Electron app remains invisible and unfocused while Playwright can locate, click, type, evaluate, and capture screenshots;
- default automated dialog and external-application requests fail without OS UI;
- an explicit deterministic dialog response can exercise confirmation flows without native UI;
- Playwright's headless and headed settings select the corresponding Electron mode;
- an occupied port 9223 prevents Electron launch;
- a mismatched CDP automation identity is rejected;
- signal and normal-exit cleanup remove the ephemeral profile and launcher metadata;
- screenshot failure still stops the process tree and reports incomplete QA;
- stale metadata for a dead process is recoverable without terminating unrelated processes;
- every scripted Electron launcher opts into automation mode;
- trusted-main extension code is rejected before its module loader runs in automation mode;
- Pi project, global, additional-path, and inline-factory extensions are excluded while skills,
  prompts, themes, context, models, and auth metadata continue to load;
- the repository check rejects an intentionally introduced unguarded OS-UI call.

Hidden E2E remains the final real-runtime verification. Headed-only native UI behavior is reported as a coverage gap unless the maintainer approves a headed run.

## QA evidence

Every completed agent-run Electron QA captures at least one representative final-state screenshot. Multi-state interactions capture enough images to prove the behavior rather than only the initial page.

The QA launcher provides a run-specific artifact directory under the OS temporary directory. Evidence screenshots never live inside the repository and are never committed. Intentional visual-regression baselines are separate test assets and are unaffected by this rule.

The agent renders every QA evidence screenshot in its final user response using the absolute artifact path. Mentioning a path without displaying the image does not satisfy the evidence requirement.

Hidden `BrowserWindow` rendering supports Playwright and CDP screenshots, so screenshot evidence does not require a visible app. If hidden capture fails, the run has not completed its QA contract. The agent reports the failure and requests exact-run approval before attempting headed QA; capture failure never grants headed access implicitly.

## Rejected approaches

- Chromium `--headless`: Playwright's Electron launch API has no headless option, and Electron does not document this as a supported application-level contract.
- Electron offscreen rendering: it changes the rendering and capture path without being necessary for Playwright interaction or screenshots.
- `showInactive()`: it can still cover the user's screen and does not meet the non-disruption contract.
- Reusing port 9222: it can collide with visible development and connect QA to the wrong process.
- Fully dynamic QA ports: the current DevTools MCP connection is fixed at server startup, so discovery would add lifecycle machinery without solving a present need.
- Reusing the normal profile: it risks data mutation and single-instance focus behavior.
- Launcher-only protection: it cannot prevent a later native dialog or external-application call from escaping into the OS UI.
