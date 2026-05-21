import type { SessionNodeId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import { SESSION_TREE } from '../constants'
import type { BuildSessionTreeRowsInput, SessionTreeRow } from '../model'
import { sessionTreeNodeKey, sessionTreeParentKey } from './session-tree-node-keys'

interface SessionTreeRowBuilderContext {
  readonly activePathIds: ReadonlySet<string>
  readonly displayedChildrenByParentId: ReadonlyMap<string | null, readonly SessionNode[]>
  readonly expandableChildrenByParentId: ReadonlyMap<string | null, readonly SessionNode[]>
  readonly originalOrderById: ReadonlyMap<string, number>
  readonly rows: SessionTreeRow[]
}

interface PushRowsInput {
  readonly node: SessionNode
  readonly visibleParentId: SessionNodeId | null
  readonly visualDepth: number
  readonly parentVisualDepth: number | null
  readonly parentJustBranched: boolean
  readonly gutterDepths: readonly number[]
  readonly siblingIndex: number
  readonly siblingCount: number
}

function appendGutterDepth(gutterDepths: readonly number[], nextDepth: number) {
  if (gutterDepths.includes(nextDepth)) {
    return gutterDepths
  }

  return [...gutterDepths, nextDepth]
}

function orderedChildren(
  children: readonly SessionNode[],
  activePathIds: ReadonlySet<string>,
  originalOrderById: ReadonlyMap<string, number>,
) {
  return [...children].sort((left, right) => {
    const leftIsActivePath = activePathIds.has(sessionTreeNodeKey(left))
    const rightIsActivePath = activePathIds.has(sessionTreeNodeKey(right))
    if (leftIsActivePath !== rightIsActivePath) {
      return leftIsActivePath
        ? SESSION_TREE.TRAVERSAL.PREVIOUS_ITEM_DELTA
        : SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
    }

    return (
      (originalOrderById.get(sessionTreeNodeKey(left)) ?? SESSION_TREE.TRAVERSAL.FIRST_INDEX) -
      (originalOrderById.get(sessionTreeNodeKey(right)) ?? SESSION_TREE.TRAVERSAL.FIRST_INDEX)
    )
  })
}

function isHiddenByCollapsedAncestor(
  node: SessionNode,
  nodeById: ReadonlyMap<string, SessionNode>,
  expandedNodeIdSet: ReadonlySet<string>,
) {
  let currentParentId = sessionTreeParentKey(node)

  while (currentParentId) {
    const parent = nodeById.get(currentParentId)
    if (!parent) {
      return false
    }
    if (!expandedNodeIdSet.has(currentParentId)) {
      return true
    }
    currentParentId = sessionTreeParentKey(parent)
  }

  return false
}

function findNearestVisibleParentId(
  node: SessionNode,
  nodeById: ReadonlyMap<string, SessionNode>,
  visibleNodeIdSet: ReadonlySet<string>,
) {
  let currentParentId = sessionTreeParentKey(node)

  while (currentParentId) {
    const parent = nodeById.get(currentParentId)
    if (!parent) {
      return null
    }
    if (visibleNodeIdSet.has(currentParentId)) {
      return parent.id
    }
    currentParentId = sessionTreeParentKey(parent)
  }

  return null
}

function appendChild(
  childrenByParentId: Map<string | null, SessionNode[]>,
  parentId: SessionNodeId | null,
  child: SessionNode,
) {
  const parentMapKey = parentId ? String(parentId) : null
  const children = childrenByParentId.get(parentMapKey) ?? []
  children.push(child)
  childrenByParentId.set(parentMapKey, children)
}

function buildChildrenByVisibleParent(input: {
  readonly nodes: readonly SessionNode[]
  readonly nodeById: ReadonlyMap<string, SessionNode>
}) {
  const visibleNodeIdSet = new Set(input.nodes.map(sessionTreeNodeKey))
  const childrenByParentId = new Map<string | null, SessionNode[]>()

  for (const node of input.nodes) {
    appendChild(
      childrenByParentId,
      findNearestVisibleParentId(node, input.nodeById, visibleNodeIdSet),
      node,
    )
  }

  return childrenByParentId
}

function childVisualDepth(input: {
  readonly parentVisualDepth: number
  readonly childCount: number
  readonly parentJustBranched: boolean
}) {
  if (input.childCount > SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA) {
    return input.parentVisualDepth + SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
  }

  if (input.parentJustBranched && input.parentVisualDepth > SESSION_TREE.LAYOUT.ROOT_VISUAL_DEPTH) {
    return input.parentVisualDepth + SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
  }

  return input.parentVisualDepth
}

function getOrderedChildren(
  context: SessionTreeRowBuilderContext,
  childrenByParentId: ReadonlyMap<string | null, readonly SessionNode[]>,
  parentId: SessionNodeId | null,
) {
  return orderedChildren(
    childrenByParentId.get(parentId ? String(parentId) : null) ?? [],
    context.activePathIds,
    context.originalOrderById,
  )
}

function appendSessionTreeRow(input: {
  readonly context: SessionTreeRowBuilderContext
  readonly row: PushRowsInput
  readonly displayedChildren: readonly SessionNode[]
  readonly expandableChildren: readonly SessionNode[]
  readonly hasNextSibling: boolean
}) {
  input.context.rows.push({
    node: input.row.node,
    visibleParentId: input.row.visibleParentId,
    visualDepth: input.row.visualDepth,
    parentVisualDepth: input.row.parentVisualDepth,
    gutterDepths: input.row.gutterDepths,
    hasPreviousSibling: input.row.siblingIndex > SESSION_TREE.TRAVERSAL.FIRST_INDEX,
    hasNextSibling: input.hasNextSibling,
    hasDisplayedChildren: input.displayedChildren.length > SESSION_TREE.TRAVERSAL.FIRST_INDEX,
    hasExpandableChildren: input.expandableChildren.length > SESSION_TREE.TRAVERSAL.FIRST_INDEX,
    expandableChildCount: input.expandableChildren.length,
  })
}

function nextChildTraversal(input: {
  readonly row: PushRowsInput
  readonly displayedChildren: readonly SessionNode[]
  readonly hasNextSibling: boolean
}) {
  const siblingRailDepth = input.row.parentVisualDepth ?? input.row.visualDepth
  const gutterDepths = input.hasNextSibling
    ? appendGutterDepth(input.row.gutterDepths, siblingRailDepth)
    : input.row.gutterDepths

  return {
    gutterDepths,
    parentJustBranched: input.displayedChildren.length > SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA,
    visualDepth: childVisualDepth({
      parentVisualDepth: input.row.visualDepth,
      childCount: input.displayedChildren.length,
      parentJustBranched: input.row.parentJustBranched,
    }),
  }
}

function pushRows(context: SessionTreeRowBuilderContext, input: PushRowsInput) {
  const displayedChildren = getOrderedChildren(
    context,
    context.displayedChildrenByParentId,
    input.node.id,
  )
  const expandableChildren = getOrderedChildren(
    context,
    context.expandableChildrenByParentId,
    input.node.id,
  )
  const hasNextSibling =
    input.siblingIndex < input.siblingCount - SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
  appendSessionTreeRow({
    context,
    row: input,
    displayedChildren,
    expandableChildren,
    hasNextSibling,
  })

  const next = nextChildTraversal({ row: input, displayedChildren, hasNextSibling })
  displayedChildren.forEach((child, index) => {
    pushRows(context, {
      node: child,
      visibleParentId: input.node.id,
      visualDepth: next.visualDepth,
      parentVisualDepth: input.visualDepth,
      parentJustBranched: next.parentJustBranched,
      gutterDepths: next.gutterDepths,
      siblingIndex: index,
      siblingCount: displayedChildren.length,
    })
  })
}

function buildRowBuilderContext(input: BuildSessionTreeRowsInput): SessionTreeRowBuilderContext {
  const nodeById = new Map(input.nodes.map((node) => [sessionTreeNodeKey(node), node]))
  const expandedNodeIdSet = new Set(input.expandedNodeIds.map(String))
  const displayedNodes = input.filteredNodes.filter(
    (node) => !isHiddenByCollapsedAncestor(node, nodeById, expandedNodeIdSet),
  )

  return {
    activePathIds: input.activePathIds,
    displayedChildrenByParentId: buildChildrenByVisibleParent({ nodes: displayedNodes, nodeById }),
    expandableChildrenByParentId: buildChildrenByVisibleParent({
      nodes: input.filteredNodes,
      nodeById,
    }),
    originalOrderById: new Map(input.nodes.map((node, index) => [sessionTreeNodeKey(node), index])),
    rows: [],
  }
}

export function getVisibleSessionTreeRows(
  input: BuildSessionTreeRowsInput,
): readonly SessionTreeRow[] {
  const context = buildRowBuilderContext(input)
  const roots = getOrderedChildren(context, context.displayedChildrenByParentId, null)

  roots.forEach((root, index) => {
    pushRows(context, {
      node: root,
      visibleParentId: null,
      visualDepth: SESSION_TREE.LAYOUT.ROOT_VISUAL_DEPTH,
      parentVisualDepth: null,
      parentJustBranched: roots.length > SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA,
      gutterDepths: [],
      siblingIndex: index,
      siblingCount: roots.length,
    })
  })

  return context.rows
}

export function getVisibleSessionTreeNodes(
  nodes: readonly SessionNode[],
  expandedNodeIds: readonly SessionNodeId[],
): readonly SessionNode[] {
  return getVisibleSessionTreeRows({
    nodes,
    filteredNodes: nodes,
    expandedNodeIds,
    activePathIds: new Set(),
  }).map((row) => row.node)
}
