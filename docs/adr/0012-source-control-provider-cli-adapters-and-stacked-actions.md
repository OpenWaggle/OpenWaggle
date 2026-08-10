# Source-Control Provider CLI Adapters And Stacked-Action Workflow

Status: accepted

OpenWaggle will reach a remote git lifecycle (push, pull, open/resolve change requests) with full parity to T3Code, supporting GitHub and GitLab through their official CLIs behind a port, and orchestrating multi-step git intents in a main-process workflow service. This records the CLI-vs-API and multi-provider trade-offs.

## Context

OpenWaggle currently has no push, no pull-request/merge-request support, and no remote source-control awareness. Its git surface stops at working-tree status, commit, branch CRUD, stage-all, and revert-all.

T3Code shells out to the `gh` and `glab` CLIs (not REST/GraphQL), derives auth from parsing `gh auth status`, and exposes a **Change request** (provider-neutral PR/MR) concept with provider-aware terminology. It orchestrates composite intents server-side in `GitWorkflowService` via a **Stacked git action** enum (`commit | push | create_pr | commit_push | commit_push_pr | pull`), emitting progress-stage events.

## Decision

**Provider access via CLI adapters behind a port.**

- Define a source-control provider port in `src/main/ports`; implement `gh` and `glab` adapters in `src/main/adapters` that shell out through the existing `execFile`/`runGit`-style runner.
- Capabilities: auth status (parse `auth status`), open change request, resolve/list change requests, **check a change request out into the working tree / Session worktree** (`gh pr checkout` / `glab mr checkout`, WS1b), and provider detection from the remote URL.
- All adapter results are discriminated-union results with explicit error codes, matching the existing `GitWorkingTreeMutationResult` style. Auth or CLI failures are surfaced as typed results, never thrown to crash the process.
- Provider-aware terminology (PR vs MR) is a small presentation map (ported from T3Code `sourceControlPresentation`); the domain term is **Change request**.

Rationale for CLI over REST/GraphQL: the CLIs own authentication (no OpenWaggle-managed token storage), it matches T3Code, and it matches OpenWaggle's existing `execFile`-based git code. Supporting both GitHub and GitLab from day one is a deliberate parity choice; the provider port keeps this from leaking into callers.

**Stacked-action orchestration in a main-process workflow service.**

- A single main-process workflow service (application/service layer) exposes one IPC per **Stacked git action** and emits progress-stage events across phases `branch → commit → push → pr` (stage copy ported from T3Code `GitActionsControl.logic.ts::buildGitActionProgressStages`).
- It composes the existing commit/branch services plus new push and provider adapters, and is the single place partial-failure and rollback are reasoned about.
- It includes auto-feature-branch creation and naming, default-branch confirmation gating, and pull.
- The renderer holds only pure decision logic (`resolveQuickAction`, `buildMenuItems`, confirmation-copy helpers) and presentation, driven by the combined Local + Remote VCS status.

## Consequences

- New port + two CLI adapters, plus the workflow service and its IPC surface.
- The renderer must not sequence multi-step git semantics across the IPC boundary; it dispatches a single stacked action and renders progress events.
- `gh`/`glab` must be installed and authenticated on the user's machine; absence/auth failure is a typed, user-visible result.
- Known environment risk: on some machines `gh`'s GraphQL path is rejected for an org when a fine-grained PAT lifetime exceeds 366 days. CLI auth otherwise works; change-request operations must degrade to typed errors, not crashes.

## Non-goals

- No direct REST/GraphQL client and no OpenWaggle-managed provider tokens.
- No provider beyond GitHub and GitLab in this iteration.
- No renderer-side orchestration of composite git actions.
