# Licensing

The split license, the CLA, and the trademark notice (ADR 0067, November 2026): what is MIT,
what is GPL-3.0, and which actions need the Project Owner.
Load before changing `package.json` license fields, publishing packages, accepting code PRs,
adding a new package, or answering licensing questions from users or companies.

## The split (ADR 0067)

- `packages/` — the four `@openwaggle/*` npm packages (`extension-sdk`, `extension-react`,
  `waggle-core`, `pi-waggle`) are **MIT**, each with its own `LICENSE` file. Those files predate
  ADR 0067 but were attributed to `Copyright (c) 2026 OpenWaggle`, a project name that is not a
  legal person; ADR 0067 re-attributed them to the Project Owner, Diego Garcia Brisa. Do not add
  copyleft to these: the extension ecosystem builds on them (ADR 0066) and
  third-party extensions keep any license they choose because the GPL app's copyleft stops at
  the MIT boundary.
- Everything else in the repository — the app, tooling, website — is **GPL-3.0-only** (root
  `LICENSE`, root `package.json` `license` field). The GPL text is verbatim FSF canonical; do not
  edit it.
- The decision order was rights over adoption: a proprietary fork of the app needs a commercial
  exception only the Project Owner (Diego Garcia Brisa and that person's successors and assigns)
  can grant. MPL-2.0 was rejected as too weak a moat; source-available (FSL/BSL) was rejected
  because it is not OSI, which closes free Windows signing (SignPath Foundation requires an
  OSI-approved license).

## The CLA

[CLA.md](../../CLA.md) at the root. Contributors keep copyright and grant the Project Owner a
perpetual, irrevocable license including relicensing and commercial terms; submitting a
Contribution means accepting it, no signature beyond that. Code PRs are not accepted yet
(CONTRIBUTING.md); when they open, enforcement is a PR checklist item or CLA Assistant, and
PRs without acceptance cannot merge. Every pre-CLA external commit is Diego's except
`7ee5fc373` (a `.fallowrc.jsonc` trim), recorded as de minimis in the ADR.

## The trademark

[TRADEMARKS.md](../../TRADEMARKS.md) at the root: the names "OpenWaggle"/"Waggle", the
`build/branding/` logos, the per-channel icons, and the visual identity are the Project Owner's
trademarks, unlicensed by MIT or GPL-3.0. Forks must rename; "based on OpenWaggle" is fine.
Neither license conveys trademark rights (MPL-2.0 excludes them explicitly; GPL-3.0 does not
grant them), but the notice removes the assumption.

## Watch for

- New packages under `packages/` default to MIT with their own `LICENSE` file; keep the
  `package/LICENSE` artifact-contract entry satisfied.
- `package.json` `license` fields: `MIT` for the four packages, `GPL-3.0-only` for the root.
- Do not add per-file license headers; the repo deliberately uses LICENSE files + package
  fields only (recorded in ADR 0067).
