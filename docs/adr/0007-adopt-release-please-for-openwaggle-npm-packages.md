# Adopt Release Please For OpenWaggle Npm Packages

Status: superseded in part by ADR-0008

ADR-0008 supersedes this decision's staged-publishing, dry-run-only dispatch, and maintainer-configuration details. The choice of Release Please, independent package versions, package dependency propagation, and monorepo ownership remains accepted.

OpenWaggle will publish `@openwaggle/extension-sdk`, `@openwaggle/extension-react`, `@openwaggle/waggle-core`, and `@openwaggle/pi-waggle` as separate npm packages through a shared Release Please package workflow, matching the existing `ts-match` release model instead of introducing Changesets. Each package keeps an independent semver version, `@openwaggle/pi-waggle` receives a dependent package bump whenever `@openwaggle/waggle-core` changes, `@openwaggle/extension-react` receives a dependent package bump whenever `@openwaggle/extension-sdk` changes, OpenWaggle-to-OpenWaggle dependencies publish as caret semver ranges, and the OpenWaggle desktop app release train remains separate from npm package publishing.

Release Please manifest mode drives package version PRs, package-local changelogs, short package-name tags such as `extension-sdk-v0.1.0`, and separate GitHub Releases for each package. This ADR originally selected staged publication after package validation. ADR-0008 replaces that publication path with direct npm Trusted Publishing from the release workflow while preserving the Release Please ownership and package-versioning decisions recorded here.

The first public publish must use the `@openwaggle` npm organization scope. If npm keeps that namespace unavailable after the deleted-account state, publishing remains blocked until the maintainer recovers or unblocks the namespace with npm support; the packages should not ship under a temporary personal scope.

The packages stay in the OpenWaggle monorepo for the first public releases so the app, extension SDK, React primitives, and Waggle runtime packages evolve against one reviewed source tree. Public package source lives under `packages/*`; existing `packages/waggle-core` and `packages/pi-waggle` should be converted into publishable packages, while `packages/extension-sdk` and `packages/extension-react` should be added as peer package roots. Package builds should use plain TypeScript project output, matching `ts-match`, instead of bundling by default. `@openwaggle/waggle-core` should remain extraction-friendly and can be reconsidered for a separate repository later if non-Pi adoption or contributor pressure justifies the extra cross-repository release overhead.
