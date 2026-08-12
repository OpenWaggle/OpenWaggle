# Adopt @pierre/diffs As The Diff Renderer, Headless-Tree For The File Navigator

Status: accepted

OpenWaggle replaces its handmade diff renderer with `@pierre/diffs`, and its handmade changed-file list with a headless tree built on `@headless-tree/react`. This records why we took on runtime dependencies for a surface we previously owned end to end, and where the boundaries sit.

## Context

The diff panel is a **feedback channel to the agent**: a user reviews the agent's uncommitted work, anchors comments to lines, and submits them. Git actions (stage, revert, publish) are secondary convenience. QA of the running app surfaced that the panel "looks bad" and is awkward to use — the review controls were unreachable under horizontal scroll, there was no syntax highlighting, no word-level diff, no split view, and no line-wrap.

The handmade renderer is ~480 lines (`DiffFileSection`, `DiffLine`, `diff-display-items`, `CollapsedLines`, plus the unified-diff parser) and a 162-line `FileTree`. Bringing it to production quality means re-implementing word-level diffing, Shiki integration, virtualization, split view, and synchronized scrolling — all of which already exist, tested, in a library the reference implementation (T3Code) already uses.

Investigation of `@pierre/diffs@1.3.2` (Apache-2.0, clears our 7-day `minimumReleaseAge` gate):

- `PatchDiff` accepts a unified patch string — exactly what our git adapter already emits, so no data-pipeline change.
- Covers every open item in issue #30 natively: word-level diffs, `diffStyle: 'unified' | 'split'`, `ScrollSyncManager`, Shiki (`shiki@4.2.0`, already a dependency), `overflow: 'scroll' | 'wrap'`, and `lineAnnotations`/`renderAnnotation`/`selectedLines`/`renderGutterUtility` purpose-built for review-comment UIs.
- Exposes 23 `--diffs-*-override` CSS variables for the diff chrome, so our tokens drive appearance (see ADR 0013 amendment).
- The line-selection force-disable that forced an 85-line patch in T3Code is gone in 1.3.2; we need no patch.

For the file navigator, `@pierre/trees` was rejected: it renders internally with `preact@11.0.0-beta.0`, so adopting it ships a second VDOM runtime — a beta major — to replace a component whose only gap versus #30 is a status glyph and a change-count badge.

## Decision

**Diff body: `@pierre/diffs@1.3.2`.** Render via `PatchDiff` from the unified patch we already produce. Delete the handmade renderer and the unified-diff parser it fed. Review comments move onto `lineAnnotations` + `renderAnnotation` (our `InlineComment` mounts inside the annotation slot); line selection via `selectedLines`/`renderGutterUtility`.

**File navigator: our own component on `@headless-tree/react`.** Headless (zero runtime dependencies; we render every row with our own Tailwind and tokens), so it gives full keyboard a11y without a second VDOM or a foreign visual language. Add the two missing #30 affordances — A/M/D status glyph and `+N/−N` counts — from per-file stats we already have.

**Review model: GitLab-style, docked in the panel.** Inline comments accumulate into a pending **Review**; a docked review bar (appearing on the first pending comment, above the git bottom bar) shows the count with Submit and Discard; Submit opens a popover with an optional **Review summary**. Submit sends the summary plus all comments to the agent as one structured `<review_comment>` message carrying each anchored hunk snippet. The composer is never involved.

**Appearance/Diff view settings.** A new Settings → Appearance section holds the persisted defaults (Syntax theme, Diff view, line wrap), write-through: the in-panel header toggles mutate the persisted setting directly, with no ephemeral per-panel copy.

**Per-hunk Stage/Discard is out of scope**, deferred to a follow-up issue. T3Code does not have it, the library only provides a pure in-memory helper (`diffAcceptRejectHunk`), and Discard is a destructive working-tree mutation we would have to write and guard ourselves — the wrong thing to add in a parity PR that is already large.

## Consequences

The renderer becomes a maintained dependency instead of ~640 lines we own. We gain word-level diffs, syntax highlighting, split view, wrap, virtualization, and synchronized scrolling essentially for free, and the review-comment affordances the panel's purpose demands.

The container-query fix that made review comments reachable under horizontal scroll (committed earlier in this PR) is superseded: the library owns overflow via `overflow: 'wrap'` and a sticky gutter. That fix is removed when the renderer is swapped.

We take on `@pierre/diffs` (+ transitive `diff`, `lru_map`, `hast-util-to-html`, `@pierre/theme`, `@pierre/theming`) and `@headless-tree/react` + `@headless-tree/core`. All Apache-2.0/MIT. `@pierre/diffs` is pinned and subject to the `minimumReleaseAge` and `trustPolicy` gates already in `pnpm-workspace.yaml`. Bundle grows; the diff renderer is lazy-loaded with the panel.

The Syntax theme sits outside the Design token contract by design (ADR 0013 amendment). A future reader must not "fix" that by folding syntax scopes into Semantic roles.

## Alternatives Considered

**Enhance the handmade renderer in place.** Rejected. Re-implementing word-level diffing, Shiki, virtualization, split view, and synchronized scrolling is a large amount of code to write and maintain, to arrive at what the library already does and T3Code already ships.

**`@pierre/trees` for the file navigator.** Rejected. A beta-major second VDOM (`preact@11.0.0-beta.0`) to replace a 162-line component whose only gap is two affordances worth ~40 lines. Its extra capabilities (drag/drop, rename, search, virtualization) are for a file browser, not a changed-file navigator over one diff.

**`react-arborist` for the navigator.** Rejected. Drags in `redux@5`, `react-dnd@14` (2021-era), and `react-window@1`, with a loose `react >= 16.14` peer range and no explicit React 19 support — four transitive deps to render tens of rows.

**Adopt the `pierre-dark` theme wholesale for chrome too.** Rejected — see ADR 0013 amendment. Its blue selection/focus against our amber accent would make the review surface an off-brand island, and would contradict ADR 0013 two days after it was accepted.

**Per-hunk Stage/Discard in this PR.** Rejected as scope. Highest risk (destructive, our own git logic), lowest visual payoff, and beyond T3Code parity. Deferred to its own issue.
