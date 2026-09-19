# Lean CI: Remove the Merge Queue and Electron E2E; Keep Release Security Intact

Status: accepted

Refines ADR 0029 (Tier CI Gates Behind a Merge Queue).

Releasing a single feature felt slow because the full gate ran repeatedly: the PR run, then the merge queue re-ran the Full gate (Windows + Linux Electron E2E plus path-scoped rehearsals) on the speculative merge result, then `push: main` ran again. The merge-queue re-run is the most expensive single duplicate (~15–25 minutes), and its Windows E2E has historically been the flakiest gate in the repo (a ~33% teardown-timeout failure rate, see MEMORY). t3code — a comparable Electron product — runs CI on `pull_request` + `push: main` with no merge queue at all.

We considered a full t3code-style rewrite (lean 3-job CI + tag/nightly release). It is incompatible with this repository's deliberately security-hardened release machinery:

- `ci.yml` is bound by a fail-closed supply-chain contract (`scripts/package-release-validator-*.ts`, run inside `pnpm check`) that requires the classify/prepare/candidate/gate jobs and SLSA provenance attestation for the published `@openwaggle/*` npm packages, and `package-release.yml` consumes the attested artifact those jobs produce.
- `release.yml` encodes human-approved app releases: `app-release-workflow.unit.test.ts` asserts the workflow never pushes to `main`, never auto-merges, and publishes only a verified human-merged release-PR commit.

Gutting either to fit a leaner shape would remove real, test-enforced security for a velocity gain. That trade-off, if ever wanted, belongs in its own focused change, not smuggled into a "make CI faster" decision.

## Decision

Move to t3code's *test strategy* while keeping OpenWaggle's supply-chain and app-release security. Concretely (see the follow-up sections below for the full rollout that shipped in one PR):

1. **Remove the merge queue.** Drop the `merge_queue` rule from the `main` ruleset so PRs merge directly once the required per-PR checks pass.
2. **Remove the Electron E2E suite.** Delete `e2e/` + `playwright.config.ts` and the three `electron-e2e-*` jobs; per-PR gating is commit policy + static + unit + integration/component + MCP conformance. A non-gating nightly cross-OS packaged canary is the compensating control.
3. **Skip the redundant app suite on the Release Please version-bump PR** via a scoped `release-pr` gate tier.

The supply-chain provenance attestation for `@openwaggle/*` (`package-release.yml` + the fail-closed guards) and the human-approved `release.yml` flow are unchanged.

## Considered Options

- **Full t3code parity (also tag/nightly *release* + no npm attestation)** — rejected: removing provenance attestation and human-approved app-release verification is a security downgrade. Only the *test strategy* (no queue, no E2E, unit/integration gating) was adopted.
- **Keep ADR 0029 as-is** — main is provably green at merge, but every merge pays the ~15–25 minute Full-gate re-run on the flaky Windows E2E, which is the pain this removes.
- **Right-size the package-release apparatus** — a legitimate separate question (the fail-closed AST contract and 4-manager consumer rehearsal are heavy for a v0.1 alpha), deliberately deferred to its own future decision.

## Consequences

- Merging is no longer gated by a merge queue: once the required per-PR checks pass, a PR merges directly. `main` can briefly go red from a semantic conflict between two independently-green PRs.
- There is no Electron E2E in CI. Renderer boot, CSP enforcement, visual baselines, and app timing budgets have no automated CI control; the nightly canary covers packaged build + native runtime load (+ the renderer syntax budget on macOS), and the rest is local/manual. See `docs/agents/e2e-removal-coverage-map.md`.
- Workflow code did change: `ci.yml`, the fail-closed gate/policy/AST-contract, and the required-status-check contexts were all updated; `release.yml` and `package-release.yml` were not.
- Adoption is a one-time ruleset edit: drop the `merge_queue` rule and set the required contexts to `Commit Policy`, `Typecheck & Lint`, `Unit Tests`, `Integration & Component Tests`, `MCP Conformance`, `Package Release Gate`.

## Follow-up: skip the redundant suite on the Release Please PR

The Release Please version-bump PR carried no source changes yet re-ran the full app suite (unit, integration/component, MCP, macOS E2E) that the feature PRs and the push to `main` already proved. Those four jobs now skip on the authenticated `release-please--branches--main` branch, and a new fail-closed gate tier `release-pr` accepts that skip while still requiring commit policy, `check`, and the package candidate (so `prepare-package-release` still builds and attests the release tarballs). The skip is scoped by exact branch match and `classify-package-release` already rejects forks and non-bot authors, so it cannot skip tests on an ordinary PR. This keeps provenance attestation and human-approved releases intact while removing the last redundant test re-run.

## Follow-up: remove the Electron E2E suite, gate on unit/integration, add a nightly canary

`pingdotgg/t3code` — a shipping multi-platform Electron product — runs CI on vitest unit + integration only and has **no E2E suite** (its `playwright-core` dependency powers an in-app browser-preview feature, not tests). OpenWaggle's 3-OS Electron E2E was the dominant CI flake (Windows ~33% teardown-timeout) and gated merges.

We delete the entire `e2e/` Playwright suite (25 specs + support) and `playwright.config.ts`, and strip the three `electron-e2e-*` jobs from `ci.yml`, the gate, and the fail-closed policy (regenerating the workflow AST contract). Per-PR gating is now commit policy + static checks + unit + integration/component + MCP conformance. A coverage-conversion audit (`docs/agents/e2e-removal-coverage-map.md`) shows the E2E suite was almost entirely belt-and-suspenders over existing unit/integration/component coverage, so no functional behavior leaves the merge gate. The genuinely E2E-only guarantees (real packaged boot, native runtime load, CSP, visual baselines, timing budgets) move to a non-gating **nightly cross-OS packaged canary** (`.github/workflows/nightly.yml`: build + `packaged-app:smoke` on macOS/Linux/Windows) plus local runs. The Playwright dependencies stay: `playwright-core` powers browser preview, and `@playwright/test` powers the package browser smoke, website screenshots, and QA tooling.
