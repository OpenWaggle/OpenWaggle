# Sidebar Provenance Icons Form A Distinct Shape Family From Status Icons

Status: accepted (design)

A session row carries two independent icon families. Status icons lead the row, are coloured, and say what the session needs from you. Provenance icons sit on the row's second line, are muted, and say what kind of session it is. No glyph appears in both families, and no two provenance concepts share a glyph. A single shape meaning two things is indistinguishable at the 10px the second line renders at.

The provenance vocabulary is fixed as:

| Concept | Glyph | Source of truth |
| --- | --- | --- |
| Git branch the session works on | `GitBranch` | `GitStatusSummary.branch` |
| Runs in its own worktree | `Split` | `SessionSummary.environmentMode === 'worktree'` |
| Cloned from another session | `CornerDownRight` | not yet recorded, see below |
| Conversation branches (count) | `ListTree` | `SessionSummary.branches` |
| Terminal process running | `Terminal` | not yet recorded per session, see below |
| Queen Session | `ChessQueen` | root Session with durable Spawn lineage |
| Worker Session | `Pickaxe` | `SessionSummary.parentSessionId` |
| Commits ahead, commits behind | `↑n`, `↓n` | `GitStatusSummary.ahead`, `.behind` |

## Context

The remodelled sidebar shows more about a session than the previous one did, on a second line that exists to carry it. That line renders glyphs at 10px to 11px. At that size a user perceives silhouette, not detail. Two concepts drawn as node-and-edge graphs are the same shape there, however different they look in a 24px legend.

This bit immediately. The first vocabulary used `GitFork` for a cloned session and `Split` for conversation branches. Both are node graphs, and the maintainer could not tell them apart in the running prototype. That is the failure this ADR exists to prevent recurring.

`CONTEXT.md` already documents the naming hazard: "branch" is ambiguous between conversation forks and git. A **SessionBranch** is a fork of the Pi message tree. A **Session worktree** is the git isolation unit. Two concepts the glossary deliberately separates must not be drawn alike, or the icons re-introduce the ambiguity the glossary resolved.

## Considered Options

**Reuse git glyphs for everything git-adjacent.** `GitBranch`, `GitFork`, `FolderGit2` and `GitCompare` are vocabulary a developer already knows, and T3Code uses `GitBranchIcon` and `FolderGit2Icon` for exactly these ideas. Rejected as a set. Four members of one visual family, all built from circles joined by lines, are mutually unreadable at 10px. Individually excellent, collectively unusable.

**Distinguish by colour instead of shape.** Rejected outright. It fails the requirement that status is never conveyed by colour alone, and it collides with the status family, which owns colour in this design.

**One glyph per meaning, chosen for distinct silhouette** (chosen). Each concept gets the most legible shape that does not collide with another concept's, accepting a weaker metaphor where legibility demands it.

- **`GitBranch` for the git branch.** Kept, because it is the one git glyph with no competitor left in the set. T3Code shows the same thing, and Codex stores `git_branch` per thread. The branch name is deliberately not rendered. It was the widest element on the second line, and the user can read it in the session itself. The name lives in `title` and `aria-label`, ready for a richer hover card later.
- **`Split` for the worktree**, not `FolderGit2`. A worktree is the repository split into a second working copy, so the metaphor holds, and `Split` has the cleanest silhouette of the candidates. `FolderGit2` is the conventional choice and T3Code's, but it is the busiest glyph in the set at 10px, where a folder outline plus git nodes resolves to a smudge. The glyph became available only because conversation branches moved to `ListTree`.
- **`CornerDownRight` for a cloned session**, not `Copy` or `GitFork`. `Copy` says "duplicate a file" and `GitFork` says "forked repository". Neither says "this session descends from another session". `CornerDownRight` reads as descent from the thing above, is two strokes so it survives 10px, and shares its silhouette with nothing else in either family.
- **`ListTree` for conversation branches**, not `Split` or `GitBranch`. It reads as a tree of messages and carries no git connotation, which is what `CONTEXT.md` requires of anything representing a **SessionBranch**. A count accompanies it rather than names, because the row has no room for names and the count is the part you act on.
- **`Terminal` for a running terminal.** `SquareTerminal` holds its shape better at this size and was recommended, but the maintainer chose `Terminal` to match the glyph used elsewhere in the product and in T3Code.
- **`ChessQueen` for the Queen Session and `Pickaxe` for every Worker Session.** The chess queen identifies the one root that originated a Hive, while the pickaxe communicates work without reusing the bee silhouette already reserved for Waggle status. Both are standard Lucide glyphs, remain distinct from the branch, tree, worktree, clone, terminal, and status families at 10px, and translate the user-facing and agent-facing Hive vocabulary directly into the sidebar. A Worker that spawns further Workers remains a `Pickaxe`; it never gains `ChessQueen`, because parent responsibility does not change its role in the Hive. When a Queen or Worker is itself a parent, the number following its role glyph counts all of its direct Worker Sessions, including active, completed, and manually archived Sessions. It does not count the complete descendant Hive or fluctuate with runtime or organizational state. `UsersRound` / `UserRound` were superseded because they described local parent/child structure but could not distinguish the one Hive root from recursive Worker parents.

## Consequences

Provenance icons are muted and never coloured, so a row's colour continues to mean one thing, what the session needs. Every provenance icon carries a `title` and an `aria-label` naming the concept and its value, so assistive technology reads the second line even though most of these concepts render no text.

Adding a provenance concept later is constrained. The new glyph must not resemble any of the seven above at 10px. That is the intended cost, and the set is small enough that you can check the constraint by looking at it.

### `Globe` is reserved for a future remote environment mode

**Session environment mode** is `local` or `worktree` today. There is no third value, and nothing in OpenWaggle runs anywhere but this machine. An earlier prototype rendered `Globe` for a "remote or background environment", imported from T3Code, where sessions do execute on the vendor's infrastructure. It was removed before implementation. A permanently false legend entry teaches users a capability the product does not have, and sends the reader looking for a feature that is not there.

The maintainer intends to tackle remote sessions in future. When a third **Session environment mode** exists, `Globe` is the glyph reserved for it. `Cloud` is T3Code's choice but generic, and `Server` implies a specific machine you own. Recording the reservation here, rather than shipping the icon behind a `TODO`, keeps the decision without asserting a state that cannot occur.

That is the rule applied to the gaps in this vocabulary. Data the app should remember but does not is marked in code and rendered when present. A capability the app does not have is recorded in an ADR and rendered never.

Two concepts are the first kind, so their glyphs exist in the vocabulary and render nothing today.

**Cloned-from.** Cloning is real, but the lineage is not persisted: `sourceSessionId` exists only inside MCP worktree derivation and never reaches a session. Recording it needs a migration adding a column plus projection through the session summary.

**Terminal.** Terminals are keyed by project path, not by session. `terminal:create` takes a `projectPath` and returns a `terminalId`, and nothing records which session opened it, so a per-session count cannot be derived. Callers pass zero until a terminal carries its owning session id.

Both render paths are complete and tested through the pure builder, so each glyph appears the moment real data exists. Neither is documented as a user-facing capability while it cannot occur, which is the same rule that kept `Globe` out.
