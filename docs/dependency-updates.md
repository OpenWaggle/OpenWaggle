# Dependency updates

Every dependency OpenWaggle installs is pinned to an exact version. A new version reaches the app
only through a pull request that changes `package.json` and `pnpm-lock.yaml`, so each upgrade gets
reviewed and goes through CI. A caret range lets a minor or patch release arrive on the next
`pnpm install` without anyone looking at it. That's the risk for packages before 1.0 (Effect
platform and SQL packages, Lexical, TanStack Hotkeys, xterm add-ons) and for packages the app
cannot run without (Electron, Pi, `node-pty`, `better-sqlite3`).

## What enforces it

- `check:repository-standards` (part of `pnpm lint`) fails when `dependencies`, `devDependencies`
  or `optionalDependencies` in the root, `packages/*` or `website` manifest holds anything other
  than an exact version, a `catalog:` reference, or a `workspace:` link. Peer dependencies are
  exempt: they state what a published package accepts from its host, such as
  `@openwaggle/extension-react`'s `react: ^19.0.0` and `@openwaggle/pi-waggle`'s `*` Pi SDKs.
  Fixture packages under `fixtures/` are test inputs and are not checked.
- `saveExact: true` in `pnpm-workspace.yaml` makes `pnpm add` write exact versions.
- The Pi runtime is one matched release in the `pi-runtime` catalog. `pnpm check:pi-runtime`
  enforces the matched set, the patches, and the root pins of `quickjs-wasi` and Photon to the
  versions Pi depends on.
- pnpm's `minimumReleaseAge` (seven days) and `trustPolicy: no-downgrade` refuse releases that are
  too new or lost their provenance. An exception is an exact `minimumReleaseAgeExclude` or
  `trustPolicyExclude` entry with its reason written next to it.

## When to update

- **Pi:** each matched Pi release, by following [Pi runtime upgrades](pi-runtime-upgrades.md). The
  patches to `pi-ai` and `pi-coding-agent` must be re-ported every time.
- **Security fixes:** as soon as the fixed release passes the seven-day window. If it can't wait,
  add a release-age exception with its reason and an expiry, the way the Pi entries do.
- **Everything else:** in batches, about once a month and between release trains. Run
  `pnpm outdated -r`, update related packages together (all `@effect/*`, all `@tanstack/*`, all
  `@xterm/*`), and keep each batch small enough to review. A dependency nobody needs to update can
  stay where it is.
- **Never during an RC freeze.** A `chore(deps):` change to app code during RC blocks Stable
  promotion ([Release and versioning](release-and-versioning.md#rc-freeze-and-promotion-guard)),
  unless it is the release-blocker fix.

## What to check in an update

- Read the changelog of every package that moves a minor version or more, and of every package
  before 1.0, where a minor release may break things.
- A package with an entry under `patchedDependencies` needs its patch re-applied to the new
  version before the lockfile changes.
- Native modules (`electron`, `node-pty`, `better-sqlite3`, `sharp`) need `pnpm prepare:native:node`
  and `pnpm prepare:native:electron`, and a packaged build (`pnpm build` and
  `pnpm packaged-app:smoke`), because native ABI problems only show up there.
- Run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm test` before opening the pull
  request.
