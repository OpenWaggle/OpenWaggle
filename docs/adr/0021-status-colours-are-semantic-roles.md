# Status Colours Are Semantic Roles, Never Palette Values Or Status Names

Status: accepted (design)

The sidebar's colours are ten semantic roles in `globals.css`. A role is named for what it means, never for the hue it currently holds and never for the feature that consumes it, so a theme can re-map a role and every consumer follows without a code change.

| Role | Value | Means |
| --- | --- | --- |
| `--color-error` | `#ef4444` | something failed |
| `--color-error-text` | `#f87171` | the same meaning, on small text |
| `--color-warning` | `#f97316` | caution, recoverable |
| `--color-info` | `#3b82f6` | information, a person is needed |
| `--color-success` | `#4caf72` | finished well |
| `--color-accent` | `#f5a623` | the product's own colour |
| `--color-review` | `#a78bfa` | waiting on a decision |
| `--color-plan` | `#e879f9` | a proposal awaiting review |
| `--color-progress` | `#7dd3fc` | work in flight |
| `--color-neutral` | `#9098a8` | no state at all |

## Context

Before this, the sidebar's statuses did not use tokens. `session-status.ts` carried raw Tailwind classes: `text-sky-500`, `text-emerald-500`, `text-indigo-500`, `text-amber-500`, `text-red-500`. The token layer existed and was bypassed, so the six semantic roles that did exist had almost no consumers: `accent` 24 uses, `success` 3, `error` 2, `warning` 2, `info` 1.

Two of those roles were also wrong. `--color-warning` held `#f5a623`, byte-identical to `--color-accent`, so a warning was indistinguishable from the brand; its only consumer was the composer's context meter, where a warning threshold rendered in the accent colour. `--color-info` held `#61a8ff`, which no status used.

The remodelled sidebar needed eight states to carry colour: the seven `SessionStatus` values plus `interrupted`, which is recorded per conversation branch rather than as a status. That many call sites reaching for palette classes would have made the bypass permanent, and it would have pinned the product's status vocabulary to one palette.

## Considered Options

**Keep raw palette classes.** Cheapest, and it is what the code already did. Rejected: a palette class says what a colour looks like, so re-theming means finding and editing every call site, and nothing stops two states drifting to the same hue.

**Introduce a primitive layer**, `--red-500` and friends, beneath the semantic roles. Rejected as duplication. Tailwind v4 already ships the palette; a second copy of it would need maintaining and would tempt call sites to use the primitive directly, which is the problem being solved.

**Name roles after the statuses that use them**, `--color-status-error`, `--color-status-working`. Rejected: it scopes a colour to one feature. The same "something failed" red is wanted in the composer, in a toast and in a diff, and a status-prefixed name makes each of those look like a misuse.

**Name roles after their hue**, `--color-violet` for the approval colour. Rejected outright: the name becomes a lie the moment the theme changes, and `--color-violet: teal` is worse than no token.

**Ten roles named for meaning** (chosen). Five carry cross-industry conventions, error, warning, info, success and the brand accent, so a reader already knows them. Four are product-specific because no convention exists for "waiting on a decision", "a plan awaiting review", "work in flight" or "no state at all". One, `--color-error-text`, exists for a contrast reason given below.

## Consequences

`session-status.ts` names roles, so the status vocabulary and the palette are now independent. A theme changes ten values.

**Two roles need a partner for text, and the baseline is the lightest row background.** A session row has three backgrounds: resting `--color-bg-secondary` `#1a1d22`, hovered `--color-bg-hover` `#262b33`, selected `--color-bg-active` `#2b313a`. Measuring against the resting one alone is the mistake this ADR originally made. Measured against the lightest, which is the binding constraint:

| role | resting | hovered | selected |
| --- | --- | --- | --- |
| `--color-error` | 4.49 | 3.78 | 3.48 |
| `--color-info` | 4.59 | 3.87 | 3.56 |

Both clear the 3:1 bar WCAG sets for icons, borders and other non-text, and both miss 4.5:1 for a label. So each keeps its chosen hue for the glyph and hands small text to a partner: `--color-error-text` at 4.74:1 and `--color-info-text` at 5.15:1 on the worst case. Every other role clears 4.5:1 on all three surfaces.

The rule for adding a role: measure against `--color-bg-active`, not the resting row. If it clears 3:1 but not 4.5:1 it may lead a row but not label one, and it needs a partner.

**Idle does not reuse `--color-text-tertiary`.** The two hold the same value today, and that is a coincidence rather than a relationship: one is a step in the text hierarchy, the other is the absence of a state. Sharing one token would have meant a readability change to text silently restyling session status, which is exactly the coupling `--color-warning` and `--color-accent` demonstrated.

**The theme block is `@theme static`.** Tailwind tree-shakes theme variables that no utility class references. `--color-neutral` is read at runtime through `var()` in an inline style rather than through a class, so without `static` it was declared and absent from the stylesheet, and an idle row's `--row-color: var(--color-neutral)` resolved to nothing while its glyph fell back to inherited colour. `--color-review` and `--color-plan` have no consumer at all yet and would also be dropped. Verified with the Tailwind CLI: a plain `@theme` emitted `--color-progress`, which a class uses, and dropped `--color-review`, which nothing uses.

**Two roles have no consumer yet.** `--color-review` and `--color-plan` are declared for states the product does not have: there is no session-level approval gate and no plan-ready status. They are kept because the prototype's palette was approved as a set and because a declared custom property costs nothing at runtime, unlike a rendered icon for a state that cannot occur, which ADR 0020 rejects. If those states never arrive, the roles should be deleted rather than repurposed.

### `--color-accent` was not renamed to `--color-primary`

`--color-primary` is the more common name and reads better beside `--color-error` and `--color-warning`, and renaming 24 call sites is mechanical. It was deferred deliberately. In most design systems `primary` implies a set, `--color-primary-hover` and `--color-primary-foreground` among them, and adopting the word without the set gives the vocabulary of a contract without the contract. That decision belongs to the design token contract work in issue #148, which owns the role set; this ADR records the option and the reason it was not taken here.
