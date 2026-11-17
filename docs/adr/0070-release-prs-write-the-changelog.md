---
status: accepted
---

# Release PRs write the changelog

Amends ADR 0040's release-notes rule. Every desktop app release PR now writes its version's entry in the root `CHANGELOG.md`, and every GitHub Release publishes that entry; prereleases no longer use GitHub's generated notes, and a Stable release no longer waits for a hand-written entry on `main`. The website publishes the same file at `/changelog/`.

A release PR used to change only `package.json`, so a release said nothing about what it contained until someone wrote notes by hand, which ADR 0040 required only for Stable. GitHub's generated prerelease notes listed PR titles, but compared against whatever tag GitHub picked, often a package tag such as `extension-react-v0.2.1`, and nobody saw them until the release was out. After 1.0.0 every release is Stable, so the hand-written gate would have held every release. We compared two approaches. release-please generates each version's entry in its release PR from Conventional Commits. Pi keeps a hand-curated `## [Unreleased]` section that each release turns into a version entry, and publishes the file at pi.dev/changelog. We took both.

## Decision

- **Generated entries.** The release PR writes `## [X.Y.Z] - YYYY-MM-DD` right under `## [Unreleased]`. The entry has Breaking changes, Features, Fixes and Performance sections, one line per Conventional Commit since the previous `v*` tag, each linked to its PR, or to its commit when the subject has no PR number. The commit range is the bump step's, and other types are left out. The squash subject, which is the PR title for a multi-commit PR, is the release note, as ADR 0040 already made it the release intent.
- **Hand-written notes, Stable only.** Notes under `## [Unreleased]` on `main` say what a release means for users. A Stable release PR moves them to the top of its entry and empties the section. A prerelease leaves them for the next Stable release, so the `1.0.0` notes written during the beta line ship with `1.0.0`. A new major `X.0.0` still needs them, as ADR 0040 required for `1.0.0`. Without them an ordinary merge waits with a notice, and a dispatch fails. The generated headings are reserved, so hand-written notes use others, such as `### Highlights`.
- **The workflow owns the release files.** A release PR's head is `main` plus a generated `package.json` version and `CHANGELOG.md`. `scripts/app-release-tree.ts` builds that tree, and the workflow verifies a release PR by building it again from the base and comparing. That check runs before CI is awaited, in CI's Commit Policy job on every release PR head, and again on the merged commit before tagging. It replaces the version-only check, and an edit to the PR's files is overwritten at the next sync.
- **Syncing a release PR.** GitHub's update-branch still merges `main` in, because the workflow token cannot push a merge that brings workflow changes. If `main` changed a release file since the branch was cut, the workflow first pushes a commit that takes `main`'s copies, so the merge cannot conflict. After the merge it pushes a commit that writes the files again, so the entry lists every commit `main` gained. Both commits change only `package.json` and `CHANGELOG.md`.
- **Backfill.** The file starts with an entry for every published `1.0.0-beta.N`, generated once from the tag ranges between published releases. Builds before `1.0.0-beta.1` stay only on GitHub Releases.

## Considered Options

- **release-please as is, with no hand-written notes.** Rejected, because a major release needs upgrade notes, and commit titles do not explain what a release means for users.
- **Pi as is, with only hand-written entries.** Rejected, because the maintainer would have to write every entry before each release, which is the gate this decision removes.
- **Notes from PR bodies.** Rejected, because PR bodies can change after merge, so the merged release commit could not be verified deterministically.
- **One note file per PR, as changesets do.** Rejected for now. It is a second place to write release information beside the PR title, which ADR 0040 avoided. Conflicts on `## [Unreleased]` can only happen between feature PRs, and the author resolves them like any other conflict.
- **Rebuilding the release branch from `main` and force-pushing it.** Rejected, because the workflow token cannot push workflow changes, and force pushes are not allowed.

## Consequences

- A release PR changes exactly `package.json` and `CHANGELOG.md`, and the maintainer reads what ships in the PR before merging it.
- Commit and PR titles are now user-facing text: an unclear `fix:` title produces an unclear changelog line.
- A sync can push up to three commits to a release PR: one that takes `main`'s files, GitHub's merge, and one that writes the files again. Only the last one's CI is awaited.
- `CHANGELOG.md` is a promotion-ignored path, so notes written during an RC window never block Stable promotion.
- The website changelog parser reads the real file in the unit tier, which runs on every PR, and the website build fails on a heading it cannot parse, so a malformed entry is caught before deploy.
