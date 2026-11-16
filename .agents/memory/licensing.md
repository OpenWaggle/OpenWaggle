# Licensing

The split license, the CLA, and the trademark notice (ADR 0067, November 2026): what is MIT,
what is GPL-3.0, and which actions need the Project Owner.
Load before changing `package.json` license fields, publishing packages, accepting code PRs,
adding a new package, or answering licensing questions from users or companies.

## The split (ADR 0067)

- `packages/` — the four `@openwaggle/*` npm packages (`extension-sdk`, `extension-react`,
  `waggle-core`, `pi-waggle`) are **MIT**, each with its own `LICENSE` file. Those files predate
  ADR 0067 but were attributed to `Copyright (c) 2026 OpenWaggle`, a project name that is not a
  legal person; ADR 0067 re-attributed them to the Project Owner, Diego Garcia Brisa. Do not add
  copyleft to these: the extension ecosystem builds on them (ADR 0066) and
  third-party extensions keep any license they choose because the GPL app's copyleft stops at
  the MIT boundary.
- Everything else in the repository — the app, tooling, website — is **GPL-3.0-only** (root
  `LICENSE`, root `package.json` `license` field). The GPL text is verbatim FSF canonical; do not
  edit it.
- The decision order was rights over adoption: a proprietary fork of the app needs a commercial
  exception only the Project Owner (Diego Garcia Brisa and that person's successors and assigns)
  can grant. MPL-2.0 was rejected as too weak a moat; source-available (FSL/BSL) was rejected
  because it is not OSI, which closes free Windows signing (SignPath Foundation requires an
  OSI-approved license).

## The CLA

[CLA.md](../../CLA.md) at the root. Contributors keep copyright and grant the Project Owner a
perpetual, irrevocable license including relicensing and commercial terms; submitting a
Contribution means accepting it, no signature beyond that act. Code PRs are open
(ADR 0067); [CLA Assistant](https://cla-assistant.io/) enforces the CLA with a merge-blocking
status check — one "I agree" through its PR comment (GitHub sign-in) covers a contributor
forever. The App connection is a maintainer action in GitHub settings, not a repo file: point it
at `CLA.md`. The PR-template-checkbox approach was rejected as the DCO idiom, not the CLA
idiom (research: VS Code, Angular, Zulip all use one-time signature + status-check bot).
Every pre-CLA external commit is Diego's except `7ee5fc373` (a `.fallowrc.jsonc` trim),
recorded as de minimis in the ADR.

## The main merge gate

Two `main` rulesets, deliberately split so CI can never be bypassed, only the approval:

- **`OpenWaggle main protections`** — deletion, non-fast-forward, a required pull request, and
  seven required status checks: Commit Policy, Typecheck & Lint, Unit Tests, Integration &
  Component Tests, MCP Conformance, Package Release Gate, and `license/cla` (CLA Assistant's
  commit status; it reports through the status API, not check runs). It carries one pre-existing
  bypass: `RepositoryRole` id `5`, the repository-admin role. That is what keeps an emergency
  default-branch change or a force push possible, since the ruleset otherwise blocks both; its
  cost is that the sole admin can also bypass a required check. Everyone else — including a
  future Maintain — faces every check.
- **`OpenWaggle approvals`** — `required_approving_review_count: 1` plus
  `require_code_owner_review`, with `bypass_actors` = the Project Owner (user
  `DiegoGBrisa`, id `77103257`). `require_code_owner_review` is what makes the approval
  *theirs*: on a public repository anyone with read access can approve, so a plain count of one
  would accept a stranger's approval. The bypass keeps their own pull requests from deadlocking
  (GitHub never counts an author's own approval), and because that ruleset holds only the review
  rule, their pull requests still face every required check.

`.github/CODEOWNERS` (`* @DiegoGBrisa`) is what the code-owner rule reads. Only the Project Owner
holds write access, so only they can merge; granting someone the **Maintain** role is what would
add the merge button for them, still under every rule above. Changing a ruleset is a GitHub
settings action, not a repo change: the enforcement lives outside the checkout, and these rules
are enforced only while the rulesets are `active` and the App is installed.

**Because `license/cla` is now required, the bot must be allowlisted.** GitHub's release
machinery authors its pull requests as `github-actions[bot]`, which cannot click "I agree", so
CLA Assistant holds `license/cla` at `pending` on every Release Please pull request and blocks it.
The allowlist lives in the CLA Assistant dashboard (import `github-actions[bot]` alongside
`dependabot[bot]`); making the check required without that entry blocks every release PR, exactly
as #475 and #476 were blocked.

## The trademark

[TRADEMARKS.md](../../TRADEMARKS.md) at the root: the names "OpenWaggle"/"Waggle", the
`build/branding/` logos, the per-channel icons, and the visual identity are the Project Owner's
trademarks, unlicensed by MIT or GPL-3.0. Forks must rename; "based on OpenWaggle" is fine.
Neither license conveys trademark rights (MPL-2.0 excludes them explicitly; GPL-3.0 does not
grant them), but the notice removes the assumption.

## Watch for

- New packages under `packages/` default to MIT with their own `LICENSE` file; keep the
  `package/LICENSE` artifact-contract entry satisfied.
- `package.json` `license` fields: `MIT` for the four packages, `GPL-3.0-only` for the root.
- Do not add per-file license headers; the repo deliberately uses LICENSE files + package
  fields only (recorded in ADR 0067).
