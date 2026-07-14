# Publish Npm Packages Directly With Trusted Publishing

Status: accepted

OpenWaggle will publish validated package tarballs directly from `package-release.yml` through npm Trusted Publishing and GitHub OIDC, rather than using staged publishing or long-lived npm tokens. A one-time resumable bootstrap publishes non-default, deprecated `0.0.0-bootstrap.0` placeholders so npm package records exist, then configures each trusted publisher with `npm trust`, disables token-based publication, and leaves every real release beginning with `0.1.0` to the provenance-bearing CI path. One coordinated Release Please PR remains the explicit human release gate; after it is merged, package-specific tags, GitHub Releases, dependency-ordered publication, and verification are automatic.

## Consequences

- Package releases are driven only by release-eligible Conventional Commits that touch their `packages/<name>/` path; desktop app release intent remains separate.
- `extension-sdk` and `waggle-core` publish before their dependents, while Release Please patch-bumps dependents when their OpenWaggle dependency changes.
- The trusted workflow is pinned to the `npm` GitHub environment, runs only from `main`, publishes exact validated tarballs, and has an exact-tag recovery dispatch.
- The bootstrap placeholder is never assigned npm's `latest` tag and is not a public API release.
