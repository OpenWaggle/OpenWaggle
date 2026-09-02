# Tier CI Gates Behind a Merge Queue

Status: accepted

CI spent most of its red runs on expensive per-push jobs that did not actually gate merges — the ruleset only required three fast checks, while the full platform E2E matrix and package rehearsals ran informationally on every push and blocked releases only indirectly. We tier the pipeline: per-push runs execute the **Fast gate** (Commit Policy, Typecheck & Lint, Unit, Integration & Component, MCP Conformance, macOS Electron E2E), and a GitHub merge queue requires the **Full gate** (adding Windows and Linux Electron E2E plus the path-scoped package rehearsals) on each speculative merge result before anything lands on `main`.

## Considered Options

- **Promote the full matrix to required per push** — makes the merge button instant-safe but reinstates 10–20 minute agent iteration loops against a ~33%-failure Windows job on every push; rejected because it is the exact failure mode this decision exists to remove.
- **Keep the status quo (full matrix informational per push)** — cheapest to keep, but "green PR" means almost nothing, agents chase unenforced reds, and nothing ever validates the *merged result*, so unverified combinations land on `main` today.

## Consequences

- Merging is no longer instant: clicking merge enqueues the PR, the Full gate validates the merged result (~15–25 minutes), and only then does it land. A queue rejection leaves the branch open with `main` untouched.
- Windows/Linux E2E and package rehearsals are skipped on ordinary PR branches by design; the merge queue's `merge_group` runs and dispatched full runs are their enforcement points. A PR that touches no package surfaces never runs consumer smoke — this is deliberate scoping, not a coverage gap.
- CI tier semantics are encoded in `scripts/package-release-gate.ts` (tiers: `full`, `fast`, `fast-no-e2e`, `visual`) and dispatched runs can request `fast` or `visual` explicitly.
