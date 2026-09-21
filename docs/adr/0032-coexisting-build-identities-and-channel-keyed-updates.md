# Coexisting build identities and channel-keyed updates

## Status

accepted

## Context

Every OpenWaggle build — the installed release, `pnpm build` in each worktree,
CI release artifacts — was produced with a single hardcoded
`productName: OpenWaggle` and `appId: com.openwaggle.app`. Result: several
identically-named, identically-iconed apps in Spotlight/Dock/Applications, all
sharing one userData directory. A four-month-old dev build (`0.3.0-alpha.32`)
was launched instead of the installed release (`0.3.0-alpha.65`) with no way to
tell them apart, and — because userData was shared — that stale build could read
and write the real app's settings and sessions. Separately, the in-app updater
reported "Update check failed": the app ships on a prerelease train
(`0.3.0-alpha.N`) and electron-updater derives an `alpha` channel from that
version, requesting `alpha-mac.yml`, which the release does not publish (only
`latest-mac.yml`).

## Decision

**One derived Build identity per build.** A single `resolve-build-identity`
module computes display name, `appId`, and icon from two inputs: the **Build
channel** and, for dev builds, a provenance slug. electron-builder consumes it
as `electron-builder.ts` (a `.ts` config loaded by electron-builder's jiti
loader); electron-vite bakes the channel and product name as runtime constants
for the About view and the updater/userData decisions.

- **Channel is provenance-gated, never version-derived at runtime.** The App
  release workflow is the sole authority that stamps a non-dev channel (an
  explicit `OPENWAGGLE_RELEASE_CHANNEL`, derived once from the tag inside the
  workflow and failing closed on an unrecognized prerelease id). Any build with
  no signal is `dev`.
- **Dev builds get a distinct, isolated identity.** Display name
  `OpenWaggle Dev (<slug>)`, `appId com.openwaggle.dev.<slug>`, a dev-badged
  icon, **isolated userData** (`app.setName(productName)` before any userData
  consumer), and **no auto-update**. This is the incident fix: a stale local
  build can neither be mistaken for the release nor act on its data.
- **Released channels share the canonical identity.** Stable/alpha/beta/rc all
  use `appId com.openwaggle.app`, the canonical `executableName "OpenWaggle"`
  (so the packaged bundle/executable names never change and release
  verification, packaged-app smoke, `install.sh`, the NSIS shim, and the
  Homebrew cask keep working), and the canonical `openwaggle` userData. They
  differ only in **display name** (`OpenWaggle Alpha`, …) and **icon** (a
  labelled ribbon badge). No install-base migration is required.
- **Per-channel icons** (canonical / alpha / beta / rc / dev), a bounded set of
  committed assets, shipped both as the packaged bundle icon and as the runtime
  `icon.png` resource (so the runtime dock icon set via `app.dock.setIcon`
  matches the channel).
- **Updater follows a user-selected release channel.** Stable maps to
  `latest*.yml`; Beta and Alpha map to their corresponding metadata files.
  Release packaging creates the cross-channel aliases that electron-builder's
  GitHub provider omits: Stable is visible to all automatic channels, Beta to
  Beta and Alpha, and Alpha only to Alpha. RC remains an exact-version channel
  because electron-updater's GitHub provider treats it as custom. The channel
  is shared by desktop Settings and `openwaggle update`; changing it never
  enables downgrades. Dev builds never auto-update.

## Deferred (explicitly out of scope)

- **Separate appId/userData per *release* channel** (installing stable and alpha
  side by side). It requires migrating the existing `com.openwaggle.app` install
  base off the canonical identity; without a migration it orphans every current
  user's sessions/settings/credentials.

## Consequences

- A build wears a visibly distinct name + icon; the About Version row shows the
  product name, so a running window is self-identifying.
- Released channels retain one app identity and data directory, while the saved
  channel determines update eligibility. Stable cannot pull a prerelease;
  opting into Beta or Alpha widens eligibility without permitting downgrades.
- Dev builds authenticate and store data separately from the installed release,
  by design — a dev build touching production credentials was the bug.
