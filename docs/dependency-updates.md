# Dependency updates

Every direct dependency in the root, `packages/*`, `tools/*` and `website` manifests is pinned to an exact
version, except `workspace:` links between monorepo packages, which `bun pm pack` publishes as
caret ranges. Every entry of the catalogs under `workspaces` in the root `package.json` is exact
too. The lockfile, `bun.lock`, already fixes what `bun install --frozen-lockfile` installs. Pinning adds two things on top of it. A
direct dependency moves only when someone edits its manifest line, so the new version is visible
in the pull request diff. And `bun update`, or a lockfile that gets re-resolved, cannot carry a
direct dependency to a newer minor or patch release on its own. Two groups need this most. Packages
before 1.0 may break things in a minor release, such as the Effect platform and SQL packages,
Lexical, TanStack Hotkeys and the xterm add-ons. And the app cannot run without Electron, Pi,
`node-pty` and `better-sqlite3`.

Transitive dependencies are not pinned. They change through the lockfile alone, and the
supply-chain settings below are what guard them.

## What enforces it

`check:repository-standards`, part of `bun run lint`, fails on a version range in `dependencies`,
`devDependencies` or `optionalDependencies` of those manifests. A `catalog:` reference or a
`workspace:` link passes; the check reads the catalog entries themselves in the root
`package.json` and fails on a range there too. Peer dependencies are exempt, because they state what a published
package accepts from its host: `@openwaggle/extension-react` accepts `react: ^19.0.0` and
`@openwaggle/pi-waggle` takes the Pi SDKs and `typebox` as `"*"` peers. Fixture packages under
`fixtures/` are test inputs and are not checked.

`exact = true` in `bunfig.toml` makes `bun add` write exact versions.

`DEPENDENCIES.md` has one line for each pin that is not npm's `latest` release or that something
holds in place, such as a patch, an override or `check:pi-runtime`: the package and version, why it
is held, and what unblocks it. `bun run check:dependency-pins`, part of `bun run check`, compares the
manifests with the merge base of `origin/main`. It fails a new or changed pin behind `latest` without
a line, and a line whose version or package no manifest uses. It asks the registry only about
changed pins without a line.

The `overrides` in the root `package.json` are not checked. Several of them are vulnerability
floors, such as `"js-yaml@^4": ^4.3.2`, which force a transitive dependency up to a fixed release
and on purpose still accept its later patches. Other overrides pin a transitive version exactly
because two packages must agree on it, as with `better-sqlite3` and the TanStack Router packages.
The `better-sqlite3` override also keeps a single SQLite build in the Session Host process; see
[One SQLite library](system-architecture.md#one-sqlite-library).

The Pi runtime is one matched release in the `pi-runtime` catalog. `bun run check:pi-runtime`
checks the matched set, the patches, and the root pins of `quickjs-wasi` and Photon to the
versions Pi depends on. It also checks that the `pi-extension-host` catalog holds the `typebox`
version `pi-coding-agent` depends on, which is the copy Pi gives extensions.

## Supply-chain settings

`minimumReleaseAge` in `bunfig.toml` refuses releases younger than seven days when Bun resolves a
new version. Versions already in `bun.lock` are not checked again. A new exception needs an exact
`name@version` entry in `minimumReleaseAgeExcludes`, with its reason in a comment next to it.

Bun has no provenance trust policy, so `bun run check:provenance`, part of `bun run check`, does
what pnpm's `trustPolicy: no-downgrade` did. It fails when a locked version has no npm provenance
but a stable version of the same package published before it had. Versions published more than 30
days ago pass, so the check covers releases between 7 and 30 days old. A reviewed exception goes
in `scripts/provenance-downgrade-policy.ts` with its reason, and the check fails once no locked
downgrade needs it. The script caches registry answers in `node_modules/.cache/openwaggle`, so a
repeat run makes no requests.

`bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs a dated canary while
everything else runs on the stable Bun in `packageManager`. The private workspace package
`tools/bun-lint` lists that canary's `@oven/bun-<platform>` binaries as optional dependencies, so
they are locked in `bun.lock` and go through the release-age gate and the provenance check. Bump
all of its versions together, to a canary at least seven days old.

Dependency install scripts run only for the packages in `trustedDependencies` in the root
`package.json`. Add a package there only when it has to build or download something at install
time, as the native modules and Electron do.

## When to update

Update Pi with each matched Pi release, by following [Pi runtime upgrades](pi-runtime-upgrades.md).
The patches to `pi-ai` and `pi-coding-agent` have to be re-ported every time.

Take a security fix as soon as the fixed release is seven days old. If it can't wait, add a
release-age exception with its reason and the date it can be removed. Only the Pi entries have an
expiry that `check:pi-runtime` enforces. For any other exception the date is a comment, so remove
the entry by hand once it passes. A vulnerable transitive dependency gets an override floor
instead.

Update everything else in batches, about once a month, and never during an RC freeze. Run
`bun outdated --recursive`, move related packages together, such as all `@effect/*`, all `@tanstack/*` or
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

Read the package's `DEPENDENCIES.md` line before moving it, and change or delete the line in the
same commit.

`node-pty`, `better-sqlite3` and `sharp` are native modules, and `electron` sets the ABI they are
rebuilt for. An update to any of them needs
`bun run prepare:native:node`, `bun run prepare:native:electron`, and a packaged build with
`bun run build:unpack` and `bun run packaged-app:smoke`, because native ABI problems only show up there.

Run `bun install --frozen-lockfile`, `bun run check` and `bun run test` before opening the pull request.
