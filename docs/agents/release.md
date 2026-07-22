# Agent Release Context

Use this file for agent-facing release and update-track decisions. The canonical release reference is `docs/release-and-versioning.md`.

## Current Release Model

OpenWaggle uses semver prerelease stages. The current release train is `0.3.0-alpha.N`.

Release automation is GitHub-based:

- CI runs typecheck, lint, and tests on PRs and pushes to `main`.
- Release workflow derives version bumps from Conventional Commit-style release-eligible commits.
- Release workflow opens a generated version PR, reruns GitHub's approval-required PR-associated CI for the exact head, and merges through normal `main` protection. Strict-base drift updates the branch and repeats CI before another merge attempt. The same run verifies the resulting protected merge commit, creates only its tag, then builds platform artifacts, publishes a GitHub Release, and attaches checksums. Reruns resume only compatible existing branch, PR, merge, and tag state; conflicting durable state fails closed.

The `0.3.0-alpha.44` recovery is intentionally exceptional: an earlier blocked direct push left that tag pointing to an unreachable commit. The reconciliation commit records `0.3.0-alpha.44` on `main` with a non-version `chore(release):` subject so no tag or build runs. Preserve the orphan tag; the next generated version PR must advance to `0.3.0-alpha.45`.

Published artifacts are currently unsigned. macOS notarization and Windows signing are release/distribution trust work, not routine implementation tasks.

## When To Load The Release Skill

Load `.agents/skills/release/SKILL.md` before changing:

- versioning
- release workflow
- updater behavior
- release notes
- installer packaging
- alpha/beta/stable track behavior
- signing, notarization, or platform distribution

## Release Notes

Until release-intent files exist, product-impacting PRs should include reviewer-facing release notes in the PR body:

- user-visible feature or behavior changes
- relevant docs updates
- validation evidence
- known remaining scope or follow-up work

Do not rely on commit subjects alone for large product changes such as Session Tree, branch lifecycle, resource precedence, provider/auth behavior, Waggle mode, or updater behavior.

## Validation

Use `.agents/verification.md` for baseline validation. For release work, prefer exact CI artifacts where possible. Post-publish installer checks are too late to prevent shipping broken installers.

## Npm Package Release Workflow

OpenWaggle npm packages use Release Please manifest mode through `release-please-config.json`, `.release-please-manifest.json`, and `.github/workflows/package-release.yml`.

- This workflow is separate from the desktop app release workflow. Package versions use path-scoped Conventional Commits; app versions use app release-intent files.
- Release Please owns one coordinated package release PR, package-local `CHANGELOG.md` files, package-specific GitHub Releases, and short component tags such as `extension-sdk-v0.1.0`.
- Package release automation validates the exact generated PR head through the normal pull-request CI path and retains the attested final tarballs for post-merge promotion.
- Release-eligible commits that touch `packages/<name>/**` or an affected package's canonical generated documentation source directly release that package. Unrelated app, website, general docs, fixture, or workflow changes do not publish npm packages.
- Pull request titles must be Conventional Commit subjects so squash merges retain package release intent. Repository policy disables merge commits and preserves squash and rebase: squash a one-intent PR, and rebase a mixed-intent PR when separate commits carry distinct release impacts. Reverts use `revert(scope): ...` rather than generated `Revert "..."` subjects.
- `@openwaggle/extension-react` is dependency-bumped when `@openwaggle/extension-sdk` changes, and `@openwaggle/pi-waggle` is dependency-bumped when `@openwaggle/waggle-core` changes, via the Release Please `node-workspace` plugin. Plan resolution and promotion reject either base release without its mandatory dependent release.
- `Package Release Gate` and `Package Release Candidate` are always reported. An unprivileged classifier makes the artifact job's intentional skip explicit on ordinary PRs; only the trusted coordinated Release Please branch grants artifact permissions and builds and attests final tarballs. The candidate aggregator fails closed unless the artifact result matches that classification. Relevant PRs run the full Node 22.19/24, four-package-manager, browser, tarball, docs, and API rehearsal.
- Release Please's runtime is pinned to the exact version bundled by the immutable action revision. Preflight generates representative changelog output and parses the configured coordinated PR title with that runtime, so incompatible action output fails before merge.
- Authors prepare future major.minor guides under `website/src/content/package-docs-next/<package>/`; published version directories remain immutable. Release Please automation runs `pnpm package-docs:update`, promotes and commits the pending line to the release branch, and dispatches CI for that exact synchronized head before maintainers can merge it.
- Merging the Release Please PR is an explicit maintainer or authorized-agent action. Never auto-merge it and do not rely on a ruleset bypass.
- Post-merge publication performs no build, test, or docs generation. It verifies the successful PR artifact's Git tree, SHA-256, `.github/workflows/ci.yml` signer identity, selected source SHA and workflow run, OIDC identity, dependency state, and unpublished version, then publishes that exact tarball through npm Trusted Publishing. Every npm integrity or dependency read retries only bounded transient failures; deterministic failures are single-attempt and fail closed.
- Create immutable package tags only after npm accepts the version, and publish the GitHub Release only after the npm version is resolvable.
- Publish `extension-sdk` and `waggle-core` before `extension-react` and `pi-waggle`, respectively.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `npm stage publish`, or a local fallback for real package versions.
- Recovery uses a manual Package Release workflow dispatch from `main` with the exact merged release commit SHA. The typed release context requires that commit to be reachable from `origin/main`, finds the package-version commit on first-parent history and uses its parent as the pre-release baseline, then resumes the exact matching attested release-candidate artifact without rebuilding or replacing an existing npm version.
- A PR that changes `packages/**` needs a `fix`, `feat`, or `revert` squash title so Release Please creates the required version. Package-changing `docs`, `chore`, and `refactor` titles fail CI; generated Release Please titles are allowed.
- All packages require Node.js `>=22.19.0`. Release validation covers Node 22.19+ and Node 24; publication uses Node 24 and pinned npm `11.18.0` until deliberately updated.
- The one-time `pnpm package-release:bootstrap --execute` path may publish deprecated `0.0.0-bootstrap.0` namespace placeholders under the `bootstrap` dist-tag, configure `npm trust`, and disable token publication. It must never publish a real package version.
- Bootstrap verifies repository merge settings and fails compatibility when they drift. Execution patches only `allow_merge_commit=false`, `allow_squash_merge=true`, and `allow_rebase_merge=true`, then reads the settings back before continuing.
- Bad published versions are deprecated and replaced with a new patch; they are not overwritten or routinely unpublished.

For package release workflow changes, run `pnpm package-release:validate`, `pnpm check`, package build/pack checks, package-doc drift checks, API snapshot checks, packed consumer smoke tests, and a Release Please dry-run where credentials allow it.
