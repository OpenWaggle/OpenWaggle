import type { SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionTreeUiState } from '@shared/types/session'

interface MoveSessionTreeFocusInput {
  readonly currentIndex: number
  readonly visibleCount: number
  readonly direction: 'next' | 'previous'
}

export interface SessionTreeRow {
  readonly node: SessionNode
  readonly visibleParentId: SessionNodeId | null
  readonly visualDepth: number
  readonly parentVisualDepth: number | null
  readonly gutterDepths: readonly number[]
  readonly hasPreviousSibling: boolean
  readonly hasNextSibling: boolean
  readonly hasDisplayedChildren: boolean
  readonly hasExpandableChildren: boolean
  readonly expandableChildCount: number
}

export interface BuildSessionTreeRowsInput {
  readonly nodes: readonly SessionNode[]
  readonly filteredNodes: readonly SessionNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly activePathIds: ReadonlySet<string>
}

export interface SessionTreeRowGeometry {
  readonly gutterWidthPx: number
  readonly rowHeightPx: number
  readonly rowCenterYPx: number
  readonly nodeCenterXPx: number
  readonly parentCenterXPx: number | null
  readonly ancestorLines: readonly SessionTreeVerticalConnector[]
  readonly nodeStemTop: SessionTreeVerticalConnector | null
  readonly nodeStemBottom: SessionTreeVerticalConnector | null
  readonly parentStemBottom: SessionTreeVerticalConnector | null
  readonly branchElbow: SessionTreeBranchElbow | null
}

export interface SessionTreeVerticalConnector {
  readonly xPx: number
  readonly yStartPx: number
  readonly yEndPx: number
}

export interface SessionTreeBranchElbow {
  readonly parentCenterXPx: number
  readonly targetCenterXPx: number
  readonly yStartPx: number
  readonly yMidPx: number
}

const TREE_GUTTER_START_PX = 14
const TREE_DEPTH_STEP_PX = 24
const TREE_GUTTER_END_PADDING_PX = 22
const TREE_ROW_HEIGHT_PX = 40
const TREE_ROW_CENTER_Y_PX = TREE_ROW_HEIGHT_PX / 2
const TREE_CONNECTOR_ROW_OVERLAP_PX = 1
const ROOT_VISUAL_DEPTH = 0
const FIRST_INDEX = 0
const NEXT_ITEM_DELTA = 1
const PREVIOUS_ITEM_DELTA = -1

function nodeKey(node: SessionNode): string {
  return String(node.id)
}

function parentKey(node: SessionNode): string | null {
  return node.parentId ? String(node.parentId) : null
}

function nodeCenterXPx(depth: number): number {
  return TREE_GUTTER_START_PX + depth * TREE_DEPTH_STEP_PX
}

function appendGutterDepth(gutterDepths: readonly number[], nextDepth: number): readonly number[] {
  if (gutterDepths.includes(nextDepth)) {
    return gutterDepths
  }

  return [...gutterDepths, nextDepth]
}

function verticalConnector(input: {
  readonly xPx: number
  readonly yStartPx: number
  readonly yEndPx: number
}): SessionTreeVerticalConnector {
  return input
}

function orderedChildren(
  children: readonly SessionNode[],
  activePathIds: ReadonlySet<string>,
  originalOrderById: ReadonlyMap<string, number>,
): readonly SessionNode[] {
  return [...children].sort((left, right) => {
    const leftIsActivePath = activePathIds.has(nodeKey(left))
    const rightIsActivePath = activePathIds.has(nodeKey(right))
    if (leftIsActivePath !== rightIsActivePath) {
      return leftIsActivePath ? PREVIOUS_ITEM_DELTA : NEXT_ITEM_DELTA
    }

    return (
      (originalOrderById.get(nodeKey(left)) ?? FIRST_INDEX) -
      (originalOrderById.get(nodeKey(right)) ?? FIRST_INDEX)
    )
  })
}

function isHiddenByCollapsedAncestor(
  node: SessionNode,
  nodeById: ReadonlyMap<string, SessionNode>,
  expandedNodeIdSet: ReadonlySet<string>,
): boolean {
  let currentParentId = parentKey(node)

  while (currentParentId) {
    const parent = nodeById.get(currentParentId)
    if (!parent) {
      return false
    }
    if (!expandedNodeIdSet.has(currentParentId)) {
      return true
    }
    currentParentId = parentKey(parent)
  }

  return false
}

function findNearestVisibleParentId(
  node: SessionNode,
  nodeById: ReadonlyMap<string, SessionNode>,
  visibleNodeIdSet: ReadonlySet<string>,
): SessionNodeId | null {
  let currentParentId = parentKey(node)

  while (currentParentId) {
    const parent = nodeById.get(currentParentId)
    if (!parent) {
      return null
    }
    if (visibleNodeIdSet.has(currentParentId)) {
      return parent.id
    }
    currentParentId = parentKey(parent)
  }

  return null
}

function appendChild(
  childrenByParentId: Map<string | null, SessionNode[]>,
  parentId: SessionNodeId | null,
  child: SessionNode,
): void {
  const parentMapKey = parentId ? String(parentId) : null
  const children = childrenByParentId.get(parentMapKey) ?? []
  children.push(child)
  childrenByParentId.set(parentMapKey, children)
}

function buildChildrenByVisibleParent(input: {
  readonly nodes: readonly SessionNode[]
  readonly nodeById: ReadonlyMap<string, SessionNode>
}): ReadonlyMap<string | null, readonly SessionNode[]> {
  const visibleNodeIdSet = new Set(input.nodes.map(nodeKey))
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
}): number {
  if (input.childCount > NEXT_ITEM_DELTA) {
    return input.parentVisualDepth + NEXT_ITEM_DELTA
  }

  if (input.parentJustBranched && input.parentVisualDepth > ROOT_VISUAL_DEPTH) {
    return input.parentVisualDepth + NEXT_ITEM_DELTA
  }

  return input.parentVisualDepth
}

export function getDefaultExpandedSessionTreeNodeIds(
  nodes: readonly SessionNode[],
): readonly SessionNodeId[] {
  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [String(node.parentId)] : [])))
  return nodes.filter((node) => parentIds.has(String(node.id))).map((node) => node.id)
}

export function resolveExpandedSessionTreeNodeIds(input: {
  readonly nodes: readonly SessionNode[]
  readonly uiState: SessionTreeUiState | null
  readonly overrideNodeIds: readonly SessionNodeId[] | null
}): readonly SessionNodeId[] {
  if (input.overrideNodeIds) {
    return input.overrideNodeIds
  }

  if (input.uiState?.expandedNodeIdsTouched) {
    return input.uiState.expandedNodeIds
  }

  return getDefaultExpandedSessionTreeNodeIds(input.nodes)
}

export function resolveSessionTreeRowExpandedNodeIds(input: {
  readonly filteredNodes: readonly SessionNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly searchActive: boolean
}): readonly SessionNodeId[] {
  if (input.searchActive) {
    return getDefaultExpandedSessionTreeNodeIds(input.filteredNodes)
  }

  return input.expandedNodeIds
}

export function getVisibleSessionTreeRows({
  nodes,
  filteredNodes,
  expandedNodeIds,
  activePathIds,
}: BuildSessionTreeRowsInput): readonly SessionTreeRow[] {
  const nodeById = new Map(nodes.map((node) => [nodeKey(node), node]))
  const originalOrderById = new Map(nodes.map((node, index) => [nodeKey(node), index]))
  const expandedNodeIdSet = new Set(expandedNodeIds.map(String))
  const expandableChildrenByParentId = buildChildrenByVisibleParent({
    nodes: filteredNodes,
    nodeById,
  })
  const displayedNodes = filteredNodes.filter(
    (node) => !isHiddenByCollapsedAncestor(node, nodeById, expandedNodeIdSet),
  )
  const displayedChildrenByParentId = buildChildrenByVisibleParent({
    nodes: displayedNodes,
    nodeById,
  })
  const rows: SessionTreeRow[] = []

  function getOrderedChildren(
    childrenByParentId: ReadonlyMap<string | null, readonly SessionNode[]>,
    parentId: SessionNodeId | null,
  ): readonly SessionNode[] {
    return orderedChildren(
      childrenByParentId.get(parentId ? String(parentId) : null) ?? [],
      activePathIds,
      originalOrderById,
    )
  }

  function pushRows(input: {
    readonly node: SessionNode
    readonly visibleParentId: SessionNodeId | null
    readonly visualDepth: number
    readonly parentVisualDepth: number | null
    readonly parentJustBranched: boolean
    readonly gutterDepths: readonly number[]
    readonly siblingIndex: number
    readonly siblingCount: number
  }): void {
    const displayedChildren = getOrderedChildren(displayedChildrenByParentId, input.node.id)
    const expandableChildren = getOrderedChildren(expandableChildrenByParentId, input.node.id)
    const hasNextSibling = input.siblingIndex < input.siblingCount - NEXT_ITEM_DELTA

    rows.push({
      node: input.node,
      visibleParentId: input.visibleParentId,
      visualDepth: input.visualDepth,
      parentVisualDepth: input.parentVisualDepth,
      gutterDepths: input.gutterDepths,
      hasPreviousSibling: input.siblingIndex > FIRST_INDEX,
      hasNextSibling,
      hasDisplayedChildren: displayedChildren.length > FIRST_INDEX,
      hasExpandableChildren: expandableChildren.length > FIRST_INDEX,
      expandableChildCount: expandableChildren.length,
    })

    const siblingRailDepth = input.parentVisualDepth ?? input.visualDepth
    const nextGutterDepths = hasNextSibling
      ? appendGutterDepth(input.gutterDepths, siblingRailDepth)
      : input.gutterDepths
    const nextVisualDepth = childVisualDepth({
      parentVisualDepth: input.visualDepth,
      childCount: displayedChildren.length,
      parentJustBranched: input.parentJustBranched,
    })
    const childrenJustBranched = displayedChildren.length > NEXT_ITEM_DELTA

    displayedChildren.forEach((child, index) => {
      pushRows({
        node: child,
        visibleParentId: input.node.id,
        visualDepth: nextVisualDepth,
        parentVisualDepth: input.visualDepth,
        parentJustBranched: childrenJustBranched,
        gutterDepths: nextGutterDepths,
        siblingIndex: index,
        siblingCount: displayedChildren.length,
      })
    })
  }

  const roots = getOrderedChildren(displayedChildrenByParentId, null)
  roots.forEach((root, index) => {
    pushRows({
      node: root,
      visibleParentId: null,
      visualDepth: ROOT_VISUAL_DEPTH,
      parentVisualDepth: null,
      parentJustBranched: roots.length > NEXT_ITEM_DELTA,
      gutterDepths: [],
      siblingIndex: index,
      siblingCount: roots.length,
    })
  })

  return rows
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

export function getSessionTreeRowGeometry(row: SessionTreeRow): SessionTreeRowGeometry {
  const nodeCenter = nodeCenterXPx(row.visualDepth)
  const parentCenter = row.parentVisualDepth === null ? null : nodeCenterXPx(row.parentVisualDepth)
  const ancestorLines = row.gutterDepths
    .filter((depth) => depth !== row.visualDepth)
    .map((depth) =>
      verticalConnector({
        xPx: nodeCenterXPx(depth),
        yStartPx: -TREE_CONNECTOR_ROW_OVERLAP_PX,
        yEndPx: TREE_ROW_HEIGHT_PX + TREE_CONNECTOR_ROW_OVERLAP_PX,
      }),
    )
  const nodeStemTop =
    row.parentVisualDepth === row.visualDepth
      ? verticalConnector({
          xPx: nodeCenter,
          yStartPx: -TREE_CONNECTOR_ROW_OVERLAP_PX,
          yEndPx: TREE_ROW_CENTER_Y_PX,
        })
      : null
  const nodeStemBottom =
    row.hasDisplayedChildren ||
    (row.hasNextSibling &&
      (row.parentVisualDepth === row.visualDepth || row.parentVisualDepth === null))
      ? verticalConnector({
          xPx: nodeCenter,
          yStartPx: TREE_ROW_CENTER_Y_PX,
          yEndPx: TREE_ROW_HEIGHT_PX + TREE_CONNECTOR_ROW_OVERLAP_PX,
        })
      : null
  const parentStemBottom =
    row.hasNextSibling && parentCenter !== null && parentCenter !== nodeCenter
      ? verticalConnector({
          xPx: parentCenter,
          yStartPx: TREE_ROW_CENTER_Y_PX,
          yEndPx: TREE_ROW_HEIGHT_PX + TREE_CONNECTOR_ROW_OVERLAP_PX,
        })
      : null
  const branchElbow =
    parentCenter !== null && parentCenter !== nodeCenter
      ? {
          parentCenterXPx: parentCenter,
          targetCenterXPx: nodeCenter,
          yStartPx: -TREE_CONNECTOR_ROW_OVERLAP_PX,
          yMidPx: TREE_ROW_CENTER_Y_PX,
        }
      : null

  return {
    gutterWidthPx: nodeCenter + TREE_GUTTER_END_PADDING_PX,
    rowHeightPx: TREE_ROW_HEIGHT_PX,
    rowCenterYPx: TREE_ROW_CENTER_Y_PX,
    nodeCenterXPx: nodeCenter,
    parentCenterXPx: parentCenter,
    ancestorLines,
    nodeStemTop,
    nodeStemBottom,
    parentStemBottom,
    branchElbow,
  }
}

export function findFirstVisibleChildIndex(
  visibleRows: readonly SessionTreeRow[],
  currentIndex: number,
): number {
  const currentRow = visibleRows[currentIndex]
  if (!currentRow) {
    return currentIndex
  }
  const childIndex = visibleRows.findIndex((row) => row.visibleParentId === currentRow.node.id)
  return childIndex >= FIRST_INDEX ? childIndex : currentIndex
}

export function findVisibleParentIndex(
  visibleRows: readonly SessionTreeRow[],
  currentIndex: number,
): number {
  const currentRow = visibleRows[currentIndex]
  if (!currentRow?.visibleParentId) {
    return currentIndex
  }
  const parentIndex = visibleRows.findIndex((row) => row.node.id === currentRow.visibleParentId)
  return parentIndex >= FIRST_INDEX ? parentIndex : currentIndex
}

export function clampSessionTreeFocusIndex(currentIndex: number, visibleCount: number): number {
  if (visibleCount <= FIRST_INDEX) {
    return FIRST_INDEX
  }
  if (currentIndex < FIRST_INDEX) {
    return FIRST_INDEX
  }
  if (currentIndex >= visibleCount) {
    return visibleCount - NEXT_ITEM_DELTA
  }
  return currentIndex
}

export function moveSessionTreeFocus({
  currentIndex,
  visibleCount,
  direction,
}: MoveSessionTreeFocusInput): number {
  if (visibleCount <= FIRST_INDEX) {
    return FIRST_INDEX
  }

  const delta = direction === 'next' ? NEXT_ITEM_DELTA : PREVIOUS_ITEM_DELTA
  return clampSessionTreeFocusIndex(currentIndex + delta, visibleCount)
}
