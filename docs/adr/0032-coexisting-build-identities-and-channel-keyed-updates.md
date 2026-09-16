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
reported "Update check failed" for every user, because the app ships on a
prerelease train (`0.3.0-alpha.N`) while electron-updater defaulted to
`allowPrerelease: false` / channel `latest` and the release published no
channel-matched feed.

## Decision

**One derived Build identity per build.** A single `resolve-build-identity`
module computes four facets — display name, `appId`, icon, userData location —
from two inputs: the **Build channel** and, for dev builds, a provenance slug.
electron-builder consumes it as a config-as-function
(`electron-builder.config.cjs`), and the same module writes channel + slug into
`build-meta.json` for the About view. Identity is never hand-set per build.

- **Channel is provenance-gated, never version-derived.** The App release
  workflow is the sole authority that stamps a non-dev channel (via an explicit
  build-time signal derived from the tag). Any build with no such signal is
  `dev`. The version string is not the signal, because every build off the
  release train carries the same `-alpha.N` version whether or not it was
  actually released — that ambiguity is what caused the original incident.
- **Coexistence with isolated data.** Distinct `appId` + userData per identity,
  so stable, alpha, and dev builds install side by side and no build can read or
  overwrite another's settings, sessions, or credentials.
- **Per-channel icons** (canonical / alpha / beta-rc / dev), a bounded set of
  committed assets. Dev builds are told apart from each other by name, not by
  generated per-worktree icons.
- **Update track equals Build channel.** A build follows the feed for its own
  channel; the release publishes channel-matched update metadata; dev builds
  never auto-update.
- **Update detection now, signed installation later.** Reliable detection +
  notify ships without code signing. Unattended one-click install (macOS
  Squirrel, Windows SmartScreen) requires an Apple Developer ID + notarization
  and a Windows signing certificate; that is a staged follow-up gated on
  obtaining those credentials, not a blocker for shipping detection.

## Consequences

- A build wears a visibly distinct name + icon, and its About view states its
  channel and dev provenance, so a running window is self-identifying.
- Channels do not share login/sessions: authenticating in an alpha build does
  not carry into stable. This is intentional — a dev build touching production
  credentials was the bug, not a feature.
- Turning on code signing later upgrades detection to seamless install with no
  rework, because the feed is already keyed to the channel.
