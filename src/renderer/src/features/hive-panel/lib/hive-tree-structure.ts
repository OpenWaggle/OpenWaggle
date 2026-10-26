import type { HiveSession } from '@/queries/session-hive-contract'
import { hiveDelegationGroup } from '@/queries/session-hive-contract'

/** Rows deeper than this keep the same indentation and show an `L5`-style badge (#377). */
export const HIVE_TREE_MAX_INDENT = 4

export interface HiveTreeRollUp {
  readonly needsAttention: number
  readonly readyForReview: number
}

/** One visible row of the Hive tree, in display order (WAI-ARIA flat tree, #377). */
export interface HiveTreeItem {
  readonly session: HiveSession
  readonly isRoot: boolean
  /** 0 for the Queen, 1 for her direct Workers. */
  readonly depth: number
  /** `aria-level`: the Queen is 1. */
  readonly level: number
  readonly indent: number
  readonly depthBadge: string | null
  readonly posInSet: number
  readonly setSize: number
  readonly parentId: string | null
  readonly parentTitle: string | null
  /** Titles from the Queen down to the parent. */
  readonly ancestry: readonly string[]
  /** Visible direct children; their rows follow unless this row is collapsed. */
  readonly childCount: number
  /** null when the row has no visible children. */
  readonly expanded: boolean | null
  /** Archived Workers hidden below this row while "Show archived" is off. */
  readonly archivedCount: number
  /** Live descendants that need the user, shown only while this row is collapsed. */
  readonly rollUp: HiveTreeRollUp | null
  readonly dimmed: boolean
  /** The parent's title while its page is not loaded; the row sits at the top level. */
  readonly orphanParentTitle: string | null
}

interface TreeNode {
  readonly session: HiveSession
  readonly children: TreeNode[]
  orphanParentTitle: string | null
}

function createdOrder(left: TreeNode, right: TreeNode) {
  const delta = (left.session.createdAt ?? 0) - (right.session.createdAt ?? 0)
  return delta !== 0 ? delta : String(left.session.id).localeCompare(String(right.session.id))
}

/**
 * Lineage the Host should never produce, a parent cycle, would leave members out of reach of the
 * Queen. Those are moved to the top level like an orphan, so every loaded member is listed.
 */
function attachUnreachable(rootNode: TreeNode, nodes: ReadonlyMap<string, TreeNode>) {
  const reached = new Set<TreeNode>()
  const pending = [rootNode]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || reached.has(node)) continue
    reached.add(node)
    pending.push(...node.children)
  }
  for (const node of nodes.values()) {
    if (reached.has(node)) continue
    for (const other of nodes.values()) {
      const index = other.children.indexOf(node)
      if (index >= 0) other.children.splice(index, 1)
    }
    node.orphanParentTitle = node.session.lineage?.parentTitle ?? '…'
    rootNode.children.push(node)
  }
}

/** The Queen with every loaded member under its parent; unloaded parents leave orphans on top. */
function buildNodes(root: HiveSession, members: readonly HiveSession[]): TreeNode {
  const rootNode: TreeNode = { session: root, children: [], orphanParentTitle: null }
  const nodes = new Map<string, TreeNode>()
  for (const member of members) {
    nodes.set(String(member.id), { session: member, children: [], orphanParentTitle: null })
  }
  for (const member of members) {
    const node = nodes.get(String(member.id))
    if (!node) continue
    const parentId = member.lineage?.parentSessionId ? String(member.lineage.parentSessionId) : null
    const parent =
      parentId === null || parentId === String(root.id) ? rootNode : nodes.get(parentId)
    if (parent !== undefined && parent !== node) {
      parent.children.push(node)
      continue
    }
    // The parent's page has not arrived: keep the Worker visible on top, never drop it.
    node.orphanParentTitle = member.lineage?.parentTitle ?? '…'
    rootNode.children.push(node)
  }
  attachUnreachable(rootNode, nodes)
  const sort = (node: TreeNode) => {
    node.children.sort(createdOrder)
    for (const child of node.children) sort(child)
  }
  sort(rootNode)
  return rootNode
}

interface Subtree {
  readonly hasLive: boolean
  readonly size: number
  readonly rollUp: HiveTreeRollUp
}

/** Facts about each node's descendants, computed once bottom-up. */
function summarize(node: TreeNode, facts: Map<TreeNode, Subtree>): Subtree {
  let hasLive = false
  let size = 0
  let needsAttention = 0
  let readyForReview = 0
  for (const child of node.children) {
    const below = summarize(child, facts)
    const live = child.session.archived !== true
    hasLive ||= live || below.hasLive
    size += 1 + below.size
    needsAttention += below.rollUp.needsAttention
    readyForReview += below.rollUp.readyForReview
    if (!live) continue
    const group = hiveDelegationGroup(child.session.lineage?.delegationState)
    if (group === 'needs-attention') needsAttention += 1
    if (group === 'ready-for-review') readyForReview += 1
  }
  const subtree = { hasLive, size, rollUp: { needsAttention, readyForReview } }
  facts.set(node, subtree)
  return subtree
}

/**
 * The Hive panel's tree (#377): each Worker under its parent, siblings by creation time.
 * Archived Workers are hidden unless `showArchived`, and counted on the nearest shown ancestor;
 * one with live children always stays, dimmed, so no live Worker loses its place.
 */
export function buildHiveTreeItems(input: {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
  readonly showArchived: boolean
  readonly collapsed: ReadonlySet<string>
}): readonly HiveTreeItem[] {
  if (input.root === null) return []
  const rootNode = buildNodes(input.root, input.members)
  const facts = new Map<TreeNode, Subtree>()
  summarize(rootNode, facts)
  const isShown = (node: TreeNode) =>
    node.session.archived !== true || input.showArchived || facts.get(node)?.hasLive === true
  const items: HiveTreeItem[] = []

  function visit(
    node: TreeNode,
    depth: number,
    ancestry: readonly string[],
    pos: number,
    size: number,
  ) {
    const shownChildren = node.children.filter(isShown)
    const archivedCount = node.children
      .filter((child) => !isShown(child))
      .reduce((total, child) => total + 1 + (facts.get(child)?.size ?? 0), 0)
    const collapsed = input.collapsed.has(String(node.session.id))
    const expanded = shownChildren.length === 0 ? null : !collapsed
    const rollUp = facts.get(node)?.rollUp
    const parentTitle = ancestry.at(-1) ?? null
    items.push({
      session: node.session,
      isRoot: depth === 0,
      depth,
      level: depth + 1,
      indent: Math.min(depth, HIVE_TREE_MAX_INDENT),
      depthBadge: depth > HIVE_TREE_MAX_INDENT ? `L${String(depth)}` : null,
      posInSet: pos,
      setSize: size,
      parentId: depth === 0 ? null : String(node.session.lineage?.parentSessionId ?? ''),
      parentTitle: node.orphanParentTitle ?? parentTitle,
      ancestry,
      childCount: shownChildren.length,
      expanded,
      archivedCount,
      rollUp:
        expanded === false && rollUp && rollUp.needsAttention + rollUp.readyForReview > 0
          ? rollUp
          : null,
      dimmed: node.session.archived === true,
      orphanParentTitle: node.orphanParentTitle,
    })
    if (expanded !== true) return
    const below = [...ancestry, node.session.title]
    shownChildren.forEach((child, index) => {
      visit(child, depth + 1, below, index + 1, shownChildren.length)
    })
  }

  visit(rootNode, 0, [], 1, 1)
  return items
}
