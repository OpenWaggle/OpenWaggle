---
status: accepted
---

# Workers live in a Hive panel, not the sidebar

Date: 2026-10-09

Supersedes in part: [ADR 0030](0030-adopt-single-local-session-host.md), its rules that spawned children "remain ordinary flat entries in the existing Session sidebar" and that Hive navigation does not "add a dedicated orchestration right sidebar".

Refines: [ADR 0043](0043-unified-right-panel-with-a-panel-rail.md), which gains a built-in Hive surface.

Every Worker was an ordinary sidebar row, so one Hive could push a dozen rows into a project, hide its Queen among them and bury the user's own sessions. The fix is to stop listing Workers beside their Queen at all. The sidebar holds the sessions the user owns. A Hive's Workers are listed in one Right panel surface that stays docked while the user moves through the Hive.

## Decision

- **The sidebar lists Queens and independent sessions.** A Worker appears there only as a Pinned session. Status chips and project roll-ups still count Workers, and a status filter or search that matches a Worker lists it as a flat row naming its parent (the Queen, for a direct Worker), so a count never points at nothing.
- **Queen rows gain no new chrome.** They keep the existing `ChessQueen` glyph and Worker count, with no accent border. When a hidden Worker needs the user — its row state needs a person, or its Delegation state puts it under Needs you — the Queen's second line says so in the normal state vocabulary and colour, for example `1 needs input`.
- **The Hive panel is a built-in Right panel surface.** Its rail icon is `ChessQueen`, the glyph already used for Hives, placed after Session Tree and Resources. It applies only to Sessions in a Hive. For any other Session it is disabled, with the reason in its tooltip, but keeps its rail position, as inapplicable extension panels already do. Its icon carries a dot while any Worker's Delegation needs the user; a Worker waiting on a parked request leaves its Delegation unchanged, so the Queen's sidebar line, which also reads row states, can report it when the dot does not.
- **The panel lists the whole Hive from its Queen, at every depth.** It shows the same list from the Queen or any Worker and highlights the current Session. Workers below the first level are labelled `via ⟨parent⟩` rather than indented. Rows are grouped by what they need: Needs you, Review, Active, Done, then a collapsed `Archived · n` (the toggle row is the archived list's only label). Rows are a three-column layout — Session, Workspace, State — under one column header for the whole list; the State cell uses the short form of the Delegation state (You, Revision, Review, Working, Waiting, Accepted, Cancelled) because the group heading already names the family, and the Workspace and State cells explain themselves on hover.
- **Navigating from the panel keeps the panel.** Opening a Hive member from it shows the Hive panel in that member too, so the user can move between Workers without the panel closing or switching surfaces.
- **Hive panel rows use the sidebar's session menu.** The same ⋯ and right-click menu offers Pin/Unpin, Rename, Regenerate title, Mark as unread, Clone, Archive and Delete, with identical behaviour. An archived row offers Unarchive in place of Archive — "Restore" reads as restoring a conversation or checkpoint. Move up and Move down remain Pinned-only.
- **A Queen's row keeps a secondary highlight while one of her Workers is open.** Selecting a Worker moves the sidebar's active highlight to it; the Queen's row keeps the active background under an accent ring (no `aria-current`), so the Hive's context stays visible without being mistaken for the open Session.
- **Pin is how a Worker reaches the sidebar.** Pinning puts it in the Pinned section, whose second line names its project and parent (the Queen, for a direct Worker). Unpinning from either place returns it to the panel only. A pinned Worker is still listed in the panel, marked as pinned.
- **Interaction protects a Worker but does not promote it.** Messaging, answering, steering or reviewing a Worker still exempts it from Hive cleanup, so it stays in the panel's active groups instead of moving under Archived. It no longer adds the Worker to the sidebar.
- **The Session Hub summarizes; the panel lists.** The Hub's Hive section, the Hive activity surface, shrinks to one row: role, Worker count, attention, and **Open in Hive panel**. The Hub cannot be shown beside the Right panel, so a second list there would vanish the moment the panel opened and could only drift from it.

## Considered Options

Each was prototyped and reviewed with the maintainer.

- **Nested tree in the sidebar.** Workers fold under their Queen, collapsed by default, with roll-up counts and an attention tint. Recursive subtrees, Queen-only collapse and depth-capped variants were all rejected. Any multi-level nesting made the sidebar feel like a file tree, and mid-tree roll-ups and double tints added machinery without making it calmer.
- **Triage sections** (Needs you / Hives / Solo) and a **flat swarm strip** of per-Worker pips on the Queen row. Rejected: both reorganize the whole sidebar around Hives.
- **One-line disclosure under the Queen**, reusing branch rows. Rejected: Workers still occupy the sidebar whenever it is open.
- **A Hive bar inside the Queen's chat**, and a **Hive switcher in the header**. Rejected as the primary list. The bar costs chat space in every Hive session. The switcher hides the Hive until it is opened, though it remains a possible later shortcut.

## Consequences

The Shortcut registry gains an unassigned Hive panel command, and the command palette lists it with the other panels. The sidebar's session grouping excludes unpinned Workers while chips, roll-ups, filters and search still see them. The Hive relations query widens from one Session's parent and direct Workers to the whole Hive under its root. The user documentation changes in the Hives guide, the Session Summary page, the right panel and shortcut references, and the pinned-session behaviour notes.

## Amendment: one name per state (#356, 1.0.0-rc.1)

The beta.25 QA found one Delegation state under five names and "Done" under three meanings. The labels above are replaced, and the decisions are otherwise unchanged:

- The groups are **Needs attention**, **Ready for review**, **Active** and **Closed**. "Done" now names only a finished Run, as in the sidebar's status chip; CONTEXT.md lists "Active/Done group" among the terms to avoid for Delegation state.
- The State cell shows the Delegation state's full label (Working, Waiting, Needs attention, Ready for review, Revision requested, Accepted, Cancelled) instead of a short form such as "You".
- A Queen's sidebar line says `1 needs attention`, matching the group and the rail tooltip.
- Each count names its scope: the panel header counts the whole Hive (`12 Workers in this Hive`), and the Session Hub's Hive row counts direct Workers by group (`3 direct Workers · 3 ready for review`). The sidebar's Worker count stays the direct count, named in its tooltip.
- A title takes up to two lines and `via ⟨parent⟩` is its own line under it, so neither a long title nor a shared title start hides which Worker a row is. The State cell wraps its longer labels.
