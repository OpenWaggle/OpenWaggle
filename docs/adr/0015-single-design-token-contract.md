# Single Design Token Contract Owned By The Extension SDK

Status: accepted

OpenWaggle will treat the semantic token set published by `@openwaggle/extension-sdk` as the one definition of its presentation roles, consumed by both the app and extensions, instead of maintaining an app-internal token system alongside it. This records the trade-off between one shared contract and two independent systems.

## Context

OpenWaggle needs a real token layer before it can offer selectable **Appearances** (dark, light, and later user-authored ones). Two facts shaped the decision.

First, the app has almost no token layer today. `globals.css` defines 75 colour roles but exactly one sizing token (`--radius-panel: 22px`). The renderer hardcodes presentation values instead:

- 451 `text-[Npx]` sites across 135 of 340 renderer components, using 10 distinct sizes (9–20px). `text-[12px]` (153) and `text-[13px]` (137) together are 64% of usage — two steps that carry no meaning, so adjacent components pick different values and the vertical rhythm breaks.
- 9+ distinct control heights (22, 24, 26, 30, 34, 40, 52, 58, 60px) with no scale.
- Raw hex in 31 component files, plus ~35 Tailwind palette colours (`text-emerald-300`, `bg-amber-500`) that bypass roles entirely and therefore cannot be re-themed.
- No runtime override layer: tokens exist only in Tailwind's compile-time `@theme` block.

Second, a semantic contract already exists and is published. `@openwaggle/extension-sdk@0.1.1` defines `OpenWaggleExtensionTheme` with role groups for `color` (18 roles), `typography`, `spacing` (`xs…xl`), `radius` (`sm/md/lg/panel`), `focus` (`ring/shadow`), and `elevation` (`card/overlay`), and maps roles to app CSS variables via `SOURCE_EXTENSION_THEME_CSS_VARIABLES`. It is guarded by an API snapshot (`scripts/api-snapshots/extension-sdk.api.md`) enforced in `pnpm check`.

That contract is only half-wired:

- Only `color`, `typography`, and `radius.panel` are mapped to real app CSS variables. `spacing`, `radius.sm/md/lg`, `focus`, and `elevation` are declared but unmapped, so extensions silently fall back to `DEFAULT_EXTENSION_THEME_TOKENS` — hardcoded values the app can never theme.
- `OpenWaggleExtensionColorScheme` is the single-member union `'dark'`, so selectable Appearances require widening a published type.

## Decision

**One Design token contract, owned by the extension SDK, consumed by the app.**

- The SDK's semantic role set is the single source of truth. The app consumes those roles; it does not define a competing scale.
- Complete the contract's unmapped groups (`spacing`, `radius.sm/md/lg`, `focus`, `elevation`) so every declared role resolves to a real app CSS variable rather than an SDK fallback.
- Widen `OpenWaggleExtensionColorScheme` to `'dark' | 'light'`. This is a deliberate, governed change: the API snapshot gate, a package version bump, and a CHANGELOG entry all apply.
- Add a runtime override layer (`[data-theme]`) on top of Tailwind's `@theme` defaults so an **Appearance** can be switched without a rebuild.
- Surface-specific values that should not be public — for example the 16 diff-panel colours such as `--color-diff-add-num` — become **Derived tokens** computed from public **Semantic roles**. They re-theme automatically but stay out of the published contract.

**Migration is split by whether equivalence is provable.**

- Mechanical and repo-wide: define one token per *existing* type size, then replace all 451 sites 1:1. This is a rename with no visual change, and it converts 451 scattered decisions into 10 central ones.
- Surgical and per-surface: control heights, padding rhythm, and radii need design judgement and change layout, so they are migrated per surface, not swept blindly.
- Deferred and deliberate: collapsing `12/13px` and `9/10px` into single steps is a visual change, reviewed on its own merits once it is a one-line edit.

## Consequences

The app's presentation roles are now a published, versioned surface. Every role change requires an API snapshot update and a package release, which slows changes but makes them visible and reviewable — appropriate for a contract third-party extensions and future user-authored Appearances depend on.

Host and extension UI cannot drift apart, because there is no second definition to drift from. This is the main reason for the decision: two parallel systems would guarantee that extensions eventually stop matching the app, which is precisely what the contract exists to prevent.

The first migration ships with one Appearance (the current dark) plus a test-only debug Appearance asserting every role actually re-renders. Shipping a second real palette at the same time would replace a provably inert migration with an unreviewable one, and would commit to 75 new colour choices before the contract has been exercised.

Tailwind's `@theme` remains the source of default values; the `[data-theme]` layer overrides them at runtime. Components must reference roles, so the raw hex and Tailwind palette usages are defects to be migrated, not accepted exceptions.

## Alternatives Considered

**Two independent systems — an app-internal scale plus the extension-facing contract.** Rejected. It removes the release friction on app-side changes, but nothing keeps the two in sync, so extension UI drifts from host UI over time. Detecting that drift requires visual comparison, which no CI gate performs.

**App-internal tokens only, with the extension contract left as a thin projection.** Rejected for the same drift reason, and because the projection would still need every role the app has, reproducing the contract without its guarantees.

**No token layer; hand-tune the affected surfaces.** Rejected. It is cheaper immediately but does not address the cause of the inconsistent rhythm, so each newly-touched surface reintroduces the same drift, and selectable Appearances stay impossible.

## Amendment (PR #145 — diff renderer)

Adopting `@pierre/diffs` as the diff renderer introduces one deliberate, bounded exception to "one contract owns all presentation":

- **The Syntax theme is out of contract.** Code token colours (keyword, string, comment) are a language-grammar taxonomy, not semantic presentation roles. Forcing them into the 18-role contract would be a category error, so the Syntax theme is user-selectable independently and is *not* a Semantic role. This is recorded so a future reader does not read it as a contract violation.
- **The Diff chrome stays in contract.** The renderer exposes 23 `--diffs-*-override` CSS variables (gutters, add/remove backgrounds, word-level emphasis, hover, selection, separators). These are wired as **Derived tokens** from our Semantic roles, so the chrome always matches the active Appearance even though a third-party theme supplies the syntax colours.
- **Three interaction colours are anchored.** `--diffs-bg-selection-override`, `--diffs-bg-selection-number-override`, and `--diffs-modified-color-override` are pinned to our accent, because line selection is how a Review comment begins and the renderer's default is blue. The initial Appearance uses the renderer's bundled dark Syntax theme (`pierre-dark`) with these three anchors; a Waggle-authored Syntax theme is a later addition, not a prerequisite.

See ADR 0016 for the renderer-replacement decision itself.
