# Remove the Merge Queue; Keep Release Security Intact

Status: proposed

Refines ADR 0029 (Tier CI Gates Behind a Merge Queue).

Releasing a single feature felt slow because the full gate ran repeatedly: the PR run, then the merge queue re-ran the Full gate (Windows + Linux Electron E2E plus path-scoped rehearsals) on the speculative merge result, then `push: main` ran again. The merge-queue re-run is the most expensive single duplicate (~15–25 minutes), and its Windows E2E has historically been the flakiest gate in the repo (a ~33% teardown-timeout failure rate, see MEMORY). t3code — a comparable Electron product — runs CI on `pull_request` + `push: main` with no merge queue at all.

We considered a full t3code-style rewrite (lean 3-job CI + tag/nightly release). It is incompatible with this repository's deliberately security-hardened release machinery:

- `ci.yml` is bound by a fail-closed supply-chain contract (`scripts/package-release-validator-*.ts`, run inside `pnpm check`) that requires the classify/prepare/candidate/gate jobs and SLSA provenance attestation for the published `@openwaggle/*` npm packages, and `package-release.yml` consumes the attested artifact those jobs produce.
- `release.yml` encodes human-approved app releases: `app-release-workflow.unit.test.ts` asserts the workflow never pushes to `main`, never auto-merges, and publishes only a verified human-merged release-PR commit.

Gutting either to fit a leaner shape would remove real, test-enforced security for a velocity gain. That trade-off, if ever wanted, belongs in its own focused change, not smuggled into a "make CI faster" decision.

## Decision

Remove the merge queue. Drop the `merge_queue` rule from the `main` branch ruleset so PRs merge directly once the required per-PR checks pass. Leave `ci.yml`, `release.yml`, `package-release.yml`, and every release guard unchanged. This eliminates the merge-queue re-run (and the flaky Windows gate on the merge path) without touching supply-chain or app-release security.

## Considered Options

- **Full t3code parity (lean CI + tag/nightly release)** — biggest reduction, but removes npm-package provenance attestation and human-approved app-release verification; rejected as a security downgrade riding inside a speed change.
- **Keep ADR 0029 as-is** — main is provably green at merge, but every merge pays the ~15–25 minute Full-gate re-run on the flaky Windows E2E, which is the pain this refinement removes.
- **Right-size the package-release apparatus** — a legitimate separate question (the fail-closed AST contract and 4-manager consumer rehearsal are heavy for a v0.1 alpha with no external consumers), deliberately deferred to its own future decision.

## Consequences

- Merging is no longer gated by the merge queue: once the required per-PR checks pass, a PR merges directly. `main` can briefly go red from a semantic conflict between two independently-green PRs.
- Windows and Linux Electron E2E and the package/website rehearsals no longer run on a merge result; they remain available via `workflow_dispatch`. macOS Electron E2E plus commit policy, static checks, unit, integration/component, and MCP conformance still gate every PR.
- No workflow code changes: the supply-chain provenance attestation for `@openwaggle/*` and the human-approved app-release flow are preserved exactly.
- Adoption is a one-time ruleset edit (drop the `merge_queue` rule) plus updating the required-status-check contexts if any referenced only the merge queue.
