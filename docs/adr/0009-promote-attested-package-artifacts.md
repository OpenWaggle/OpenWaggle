# Promote Attested Package Artifacts From The Release Pull Request

Status: accepted

OpenWaggle package releases will build, validate, hash, and attest final package tarballs on the Release Please pull request. After an authorized merge, the release workflow will publish those exact artifacts instead of rebuilding from `main`. Git tree identity connects the validated pull request content to squash- or rebase-merged content even when the commit SHA changes.

The pre-merge `Package Release Gate` and `Package Release Candidate` are always present and every pull request runs the complete release rehearsal. An unprivileged classifier makes the artifact job's intentional skip explicit for ordinary pull requests, while the always-present candidate aggregator verifies that outcome. Trusted Release Please pull requests additionally upload the final-version artifact manifest, package tarballs, SHA-256 digests, source tree identity, and GitHub build provenance.

Post-merge publication is deliberately narrow. It verifies artifact provenance, tree identity, digest, package/version plan, GitHub OIDC identity, dependency availability, and unpublished npm state. It performs no build, test, API generation, documentation generation, or package mutation. It publishes bases before dependents, retries transient registry failures, creates immutable package tags only after npm accepts each version, and creates GitHub Releases only after the matching npm version is resolvable.

## Considered Options

- Rebuilding after merge is operationally simple, but it proves a different execution than the one reviewers approved and allows post-merge tool or dependency drift to create a new artifact.
- Publishing from every package-affecting pull request would remove the release PR handoff, but it would publish versions before the explicit maintainer release decision and before Release Please finalizes coordinated versions and changelogs.
- Staged npm publishing would provide a registry-side approval step, but npm staged publishing requires interactive approval and conflicts with unattended trusted publication after the maintainer has already approved the release PR.

## Consequences

- Failures that can be predicted from source, package contents, consumers, docs, or API shape block the pull request instead of consuming release attempts after merge.
- Release Please PRs are never auto-merged. Only a maintainer or explicitly authorized agent decides when the attested candidate is ready to publish.
- Repository rules must require the current `Package Release Gate` and must not retain a routine bypass for release automation.
- The release workflow needs durable artifact identity and retention long enough for merge and bounded recovery.
- Recovery resumes an exact attested candidate; it does not rebuild a tag or overwrite immutable npm history.
- Canonical website package documentation generates committed npm READMEs and API references. Drift is a pre-merge failure, and generated package-surface changes carry package release intent.
