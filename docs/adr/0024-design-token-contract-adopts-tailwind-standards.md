# Design Token Contract Adopts Tailwind Standards

Status: accepted

OpenWaggle's Design token contract adopts Tailwind v4's standard scales as its vocabulary instead of bespoke closed scales, and exposes the full themeable variable surface to extensions, so agents style with standard utilities and user-authored Appearances override one documented surface. This supersedes the bespoke-values redesign direction recorded for issue #148 and amends ADR 0015's contract groups.

## Context

Issue #148 began as a bespoke redesign: a closed five-role Type scale (caption/label/body/title/code), a three-step Control size scale (sm/md/lg), a seven-step Spacing scale (2xs–2xl), and contract-defined radius steps, enforced by renaming every utility to a named role. Slice 1 shipped that contract as extension-sdk 0.2.0.

Before merge, the maintainer redirected the effort on two grounds. First, consumption cost: agents already know Tailwind, so inventing a parallel vocabulary (text-body, space-md, control-sm) taxes every future implementation and invites deviation. Second, purpose: the real reason the token work exists is user-authored Appearances — the contract must be a standard-shaped, documented, validated override surface with a good authoring DX.

Two facts made the redirect clean. Tailwind v4's utilities already consume CSS variables: `text-sm` reads `var(--text-sm)`, `rounded-md` reads `var(--radius-md)`, `p-4` reads `calc(var(--spacing) * 4)`, `shadow-md` reads `var(--shadow-md)`. "Tailwind standards" and "a token layer" are therefore not in tension: the standards are the consumption layer and the variables they read are the token layer. And the app's actual usage had outgrown the bespoke scales anyway: 16/18/20px headings above the bespoke 15px ceiling, radius steps (4/5/6/8/10/12px) that never matched the contract's 6/9/12px, and twelve distinct control heights against a three-step scale.

## Decision

**Consumption: Tailwind v4 defaults are the only vocabulary, zero exceptions.**

- Text snaps to the standard scale (xs/sm/base/lg/xl/2xl); spacing and sizing snap to the 2px numeric grid; radius uses the standard `rounded-*` steps; heights use `h-N`.
- Snap rule: nearest standard value, ties round up.
- No bespoke utility names, no added scale steps, no arbitrary bracket values for text, spacing, sizing, or radius.

**Token surface: the complete variable set the utilities read, declared in `@theme`.**

- Semantic colours: the full ADR 0021 palette — 23 roles, including `neutral`, `review`, `plan`, `progress`, and `dangerText`/`infoText` partners exactly where the contrast floor demands them.
- Typography families and the standard text steps (`--text-*`), the spacing unit (`--spacing`), the radius steps (`--radius-*`), the shadow steps (`--shadow-*`), and the focus stance (draws nothing, by decision).
- Defaults are Tailwind's standard values; values that failed the contrast floor are lifted.

**Runtime: the `[data-theme]` override layer on `:root`.** An Appearance is a named set of overrides on the themeable surface. Dark is the default when the attribute is absent; a dev/test-only debug Appearance proves every role re-renders.

**Contract (extension-sdk 0.2.0): the same surface, projected to extensions.**

- Groups: 23 colours; typography (families plus the standard text steps); the spacing unit; radius xs–4xl; shadow 2xs–2xl; focus.
- No type-scale roles, no control sizes, no elevation group: heights are spacing-unit utilities, and elevation is standardized onto Tailwind's shadows.
- The extension stylesheet consumes the projected variables (spacing through `calc` multiples), so a theme that re-densifies or re-rounds the host re-themes extensions too.

**Guardrails make deviation structurally impossible.**

- Utilities are the only consumption path: lint bans arbitrary bracket values in the snapped families, raw hex, and Tailwind palette colours.
- Variables are the only override path: Appearances override variables, never classes.

## Consequences

Numeric spacing, height, and radius utilities are canonical, not a second vocabulary to eliminate. Three of issue #148's acceptance criteria were translated accordingly: "zero numeric spacing/radius utilities" became "zero arbitrary bracket values in the snapped families"; "control heights use sm/md/lg" became "heights use standard `h-N` utilities"; "maintainer freezes scale values from screenshots" became "values are standards, conformance is enforced", because a standard leaves nothing to freeze. The bespoke groups were removed from the published contract before 0.2.0 shipped. Migration runs guardrails first: the lint rules land red, codemods and judgment-site fixes follow, and the rules end green. Extension UI follows user Appearances by construction — the DX the theming effort exists to protect.

## Alternatives Considered

**Bespoke closed scales (the original #148 plan).** Rejected after slice 1: every agent pays to learn a second vocabulary, and the app's real usage (headings above 15px, unmatched radius steps, twelve control heights) had already broken the closed sets.

**Tailwind standards with a minimal colours-only contract.** Rejected: spacing, radius, text steps, and shadows are themeable variables in Tailwind v4, so a theme that changes them would leave extension UI behind. The contract projects the full themeable surface.

**Limited exceptions (a sub-xs text step, a bespoke panel radius).** Rejected: exceptions breed reproductions; zero deviation is the point.
