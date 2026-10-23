# Dependency updates

Every direct dependency in the root, `packages/*` and `website` manifests is pinned to an exact
version, except `workspace:` links between monorepo packages, which pnpm publishes as caret
ranges. Every entry of the pnpm catalogs in `pnpm-workspace.yaml` is exact too. The lockfile already
fixes what `pnpm install --frozen-lockfile` installs. Pinning adds two things on top of it. A
direct dependency moves only when someone edits its manifest line, so the new version is visible
in the pull request diff. And `pnpm update`, or a lockfile that gets re-resolved, cannot carry a
direct dependency to a newer minor or patch release on its own. Two groups need this most. Packages
before 1.0 may break things in a minor release, such as the Effect platform and SQL packages,
Lexical, TanStack Hotkeys and the xterm add-ons. And the app cannot run without Electron, Pi,
`node-pty` and `better-sqlite3`.

Transitive dependencies are not pinned. They change through the lockfile alone, and the
supply-chain settings below are what guard them.

## What enforces it

`check:repository-standards`, part of `pnpm lint`, fails on a version range in `dependencies`,
`devDependencies` or `optionalDependencies` of those manifests. A `catalog:` reference or a
`workspace:` link passes; the check reads the catalog entries themselves in `pnpm-workspace.yaml`
and fails on a range there too. Peer dependencies are exempt, because they state what a published
package accepts from its host: `@openwaggle/extension-react` accepts `react: ^19.0.0` and
`@openwaggle/pi-waggle` takes the Pi SDKs and `typebox` as `"*"` peers. Fixture packages under
`fixtures/` are test inputs and are not checked.

`saveExact: true` in `pnpm-workspace.yaml` makes `pnpm add` write exact versions.

The `overrides` in `pnpm-workspace.yaml` are not checked. Several of them are vulnerability
floors, such as `"js-yaml@^4": ^4.3.2`, which force a transitive dependency up to a fixed release
and on purpose still accept its later patches. Other overrides pin a transitive version exactly
because two packages must agree on it, as with `better-sqlite3` and the TanStack Router packages.

The Pi runtime is one matched release in the `pi-runtime` catalog. `pnpm check:pi-runtime`
checks the matched set, the patches, and the root pins of `quickjs-wasi` and Photon to the
versions Pi depends on. It also checks that the `pi-extension-host` catalog holds the `typebox`
version `pi-coding-agent` depends on, which is the copy Pi gives extensions.

pnpm's `minimumReleaseAge` of seven days refuses releases newer than that. `trustPolicy:
no-downgrade` refuses a release that lost the provenance or signatures earlier releases had, and
`trustPolicyIgnoreAfter` limits that check to releases between 7 and 30 days old. A new exception
needs an exact `minimumReleaseAgeExclude` entry with its reason in a comment next to it. Avoid
`trustPolicyExclude`: pnpm 11.6.0 drops the last entry of that list, which is why it ends with a
sentinel that must stay last.

## When to update

Update Pi with each matched Pi release, by following [Pi runtime upgrades](pi-runtime-upgrades.md).
The patches to `pi-ai` and `pi-coding-agent` have to be re-ported every time.

Take a security fix as soon as the fixed release is seven days old. If it can't wait, add a
release-age exception with its reason and the date it can be removed. Only the Pi entries have an
expiry that `check:pi-runtime` enforces. For any other exception the date is a comment, so remove
the entry by hand once it passes. A vulnerable transitive dependency gets an override floor
instead.

Update everything else in batches, about once a month, and never during an RC freeze. Run
`pnpm outdated -r`, move related packages together, such as all `@effect/*`, all `@tanstack/*` or
all `@xterm/*`, and keep each batch small enough to review. A dependency nobody needs to update
can stay where it is.

During an RC freeze, a `chore(deps):` change to app code blocks
Stable promotion, unless it is the fix for a release blocker. See
[Release and versioning](release-and-versioning.md#rc-freeze-and-promotion-guard).

## What to check in an update

Read the changelog of every package that moves a minor version or more, and of every package
before 1.0.

A package listed under `patchedDependencies` needs its patch re-applied to the new version before
the lockfile changes.

`electron`, `node-pty`, `better-sqlite3` and `sharp` are native modules. An update to one needs
`pnpm prepare:native:node`, `pnpm prepare:native:electron`, and a packaged build with
`pnpm build:unpack` and `pnpm packaged-app:smoke`, because native ABI problems only show up there.

Run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm test` before opening the pull request.
