import { getMessageText } from '@shared/types/agent'
import type { SessionNode, SessionTree } from '@shared/types/session'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { RefObject } from 'react'
import { cn } from '@/lib/cn'
import {
  getSessionTreeRowGeometry,
  type SessionTreeRow,
  type SessionTreeRowGeometry,
} from './session-tree-visibility'

interface SessionTreeRowsProps {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activePathIds: ReadonlySet<string>
  readonly clampedFocusIndex: number
  readonly draftBranch: {
    readonly sessionId: SessionNode['sessionId']
    readonly sourceNodeId: SessionNode['id']
  } | null
  readonly rowExpandedNodeIds: readonly SessionNode['id'][]
  readonly rowRefs: RefObject<Map<string, HTMLButtonElement>>
  readonly tree: SessionTree
  readonly visibleRows: readonly SessionTreeRow[]
  readonly onFocusIndex: (index: number) => void
  readonly onSelectNode: (node: SessionNode) => void
  readonly onToggleNodeExpanded: (row: SessionTreeRow) => void
}

interface SessionTreeRowItemProps {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activePathIds: ReadonlySet<string>
  readonly clampedFocusIndex: number
  readonly draftBranch: SessionTreeRowsProps['draftBranch']
  readonly index: number
  readonly row: SessionTreeRow
  readonly rowExpandedNodeIds: readonly SessionNode['id'][]
  readonly rowRefs: RefObject<Map<string, HTMLButtonElement>>
  readonly tree: SessionTree
  readonly onFocusIndex: (index: number) => void
  readonly onSelectNode: (node: SessionNode) => void
  readonly onToggleNodeExpanded: (row: SessionTreeRow) => void
}

interface SessionTreeBadgeProps {
  readonly label: string
  readonly tone: 'accent' | 'muted' | 'warning'
}

interface SessionTreeConnectorOverlayProps {
  readonly geometry: SessionTreeRowGeometry
  readonly active: boolean
}

const TREE_NODE_DOT_SIZE_PX = 14
const TREE_NODE_DOT_OFFSET_PX = TREE_NODE_DOT_SIZE_PX / 2
const TREE_CONNECTOR_STROKE_WIDTH_PX = 1.5
const TREE_CONNECTOR_ACTIVE_STROKE = 'color-mix(in srgb, var(--color-accent) 58%, transparent)'
const TREE_CONNECTOR_ACTIVE_FILTER =
  'drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 24%, transparent))'
const TREE_CONNECTOR_MUTED_STROKE = 'color-mix(in srgb, var(--color-border-light) 58%, transparent)'
const TREE_CONNECTOR_ANCESTOR_STROKE =
  'color-mix(in srgb, var(--color-border-light) 38%, transparent)'

function nodeLabel(node: SessionNode): string {
  if (node.message) {
    const text = getMessageText(node.message).replace(/\s+/g, ' ').trim()
    if (text) {
      return text
    }
  }

  return node.kind.replace(/_/g, ' ')
}

function nodeRoleLabel(node: SessionNode): string {
  if (node.kind === 'user_message') return 'User'
  if (node.kind === 'assistant_message') return 'Assistant'
  if (node.kind === 'tool_result') return 'Tool'
  if (node.kind === 'branch_summary') return 'Branch summary'
  if (node.kind === 'compaction_summary') return 'Compaction'
  return node.kind.replace(/_/g, ' ')
}

function isActivePathNode(node: SessionNode, activePathIds: ReadonlySet<string>): boolean {
  return activePathIds.has(String(node.id))
}

function isExpandedNode(node: SessionNode, expandedNodeIds: readonly SessionNode['id'][]): boolean {
  return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id))
}

function SessionTreeBadge({ label, tone }: SessionTreeBadgeProps) {
  return (
    <span
      className={cn(
        'rounded border px-1 py-0.5 text-[10px] leading-none',
        tone === 'accent' && 'border-accent/40 bg-accent/10 text-accent',
        tone === 'muted' && 'border-border bg-bg-secondary text-text-muted',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      {label}
    </span>
  )
}

function SessionTreeConnectorOverlay({ geometry, active }: SessionTreeConnectorOverlayProps) {
  const connectorStroke = active ? TREE_CONNECTOR_ACTIVE_STROKE : TREE_CONNECTOR_MUTED_STROKE
  const connectorFilter = active ? TREE_CONNECTOR_ACTIVE_FILTER : undefined

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={geometry.gutterWidthPx}
      height={geometry.rowHeightPx}
      viewBox={`0 0 ${geometry.gutterWidthPx} ${geometry.rowHeightPx}`}
    >
      {geometry.ancestorLines.map((line) => (
        <line
          key={`${line.xPx}:${line.yStartPx}:${line.yEndPx}`}
          x1={line.xPx}
          y1={line.yStartPx}
          x2={line.xPx}
          y2={line.yEndPx}
          stroke={TREE_CONNECTOR_ANCESTOR_STROKE}
          strokeLinecap="round"
          strokeWidth={TREE_CONNECTOR_STROKE_WIDTH_PX}
        />
      ))}
      {geometry.parentStemBottom ? (
        <line
          x1={geometry.parentStemBottom.xPx}
          y1={geometry.parentStemBottom.yStartPx}
          x2={geometry.parentStemBottom.xPx}
          y2={geometry.parentStemBottom.yEndPx}
          stroke={TREE_CONNECTOR_ANCESTOR_STROKE}
          strokeLinecap="round"
          strokeWidth={TREE_CONNECTOR_STROKE_WIDTH_PX}
        />
      ) : null}
      {geometry.branchElbow ? (
        <path
          d={`M ${geometry.branchElbow.parentCenterXPx} ${geometry.branchElbow.yStartPx} V ${geometry.branchElbow.yMidPx} H ${geometry.branchElbow.targetCenterXPx}`}
          fill="none"
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={TREE_CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
      {geometry.nodeStemTop ? (
        <line
          x1={geometry.nodeStemTop.xPx}
          y1={geometry.nodeStemTop.yStartPx}
          x2={geometry.nodeStemTop.xPx}
          y2={geometry.nodeStemTop.yEndPx}
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeWidth={TREE_CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
      {geometry.nodeStemBottom ? (
        <line
          x1={geometry.nodeStemBottom.xPx}
          y1={geometry.nodeStemBottom.yStartPx}
          x2={geometry.nodeStemBottom.xPx}
          y2={geometry.nodeStemBottom.yEndPx}
          stroke={connectorStroke}
          strokeLinecap="round"
          strokeWidth={TREE_CONNECTOR_STROKE_WIDTH_PX}
          style={{ filter: connectorFilter }}
        />
      ) : null}
    </svg>
  )
}

export function SessionTreeRows({
  activeBranchId,
  activePathIds,
  clampedFocusIndex,
  draftBranch,
  rowExpandedNodeIds,
  rowRefs,
  tree,
  visibleRows,
  onFocusIndex,
  onSelectNode,
  onToggleNodeExpanded,
}: SessionTreeRowsProps) {
  return (
    <div>
      {visibleRows.map((row, index) => (
        <SessionTreeRowItem
          key={String(row.node.id)}
          activeBranchId={activeBranchId}
          activePathIds={activePathIds}
          clampedFocusIndex={clampedFocusIndex}
          draftBranch={draftBranch}
          index={index}
          row={row}
          rowExpandedNodeIds={rowExpandedNodeIds}
          rowRefs={rowRefs}
          tree={tree}
          onFocusIndex={onFocusIndex}
          onSelectNode={onSelectNode}
          onToggleNodeExpanded={onToggleNodeExpanded}
        />
      ))}
    </div>
  )
}

function SessionTreeRowItem({
  activeBranchId,
  activePathIds,
  clampedFocusIndex,
  draftBranch,
  index,
  row,
  rowExpandedNodeIds,
  rowRefs,
  tree,
  onFocusIndex,
  onSelectNode,
  onToggleNodeExpanded,
}: SessionTreeRowItemProps) {
  const node = row.node
  const activePath = isActivePathNode(node, activePathIds)
  const expanded = isExpandedNode(node, rowExpandedNodeIds)
  const nodeBranches = tree.branches.filter((branch) => branch.headNodeId === node.id)
  const isActiveBranchHead = nodeBranches.some((branch) => branch.id === activeBranchId)
  const isDraftNode =
    draftBranch?.sessionId === tree.session.id && draftBranch.sourceNodeId === node.id
  const archivedBranch = nodeBranches.find((branch) => branch.archived === true)
  const geometry = getSessionTreeRowGeometry(row)
  const nodeHighlighted = activePath || isActiveBranchHead || isDraftNode
  const rowHighlighted = isActiveBranchHead || isDraftNode

  return (
    <div className="session-tree-row-enter group flex min-w-0 items-center">
      <div className="relative h-10 shrink-0" style={{ width: geometry.gutterWidthPx }}>
        <SessionTreeConnectorOverlay geometry={geometry} active={activePath} />
        {row.hasExpandableChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse tree node' : 'Expand tree node'}
            onFocus={() => onFocusIndex(index)}
            onClick={() => onToggleNodeExpanded(row)}
            className={cn(
              'session-tree-node-dot absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out hover:scale-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
              nodeHighlighted
                ? 'session-tree-active-dot border-accent bg-accent text-bg'
                : 'border-border-light bg-diff-bg text-text-muted hover:border-accent/60 hover:bg-bg-hover hover:text-text-secondary',
            )}
            style={{
              left: geometry.nodeCenterXPx - TREE_NODE_DOT_OFFSET_PX,
              width: TREE_NODE_DOT_SIZE_PX,
              height: TREE_NODE_DOT_SIZE_PX,
            }}
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5 opacity-80" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
          </button>
        ) : (
          <span
            className={cn(
              'session-tree-node-dot absolute top-1/2 z-10 -translate-y-1/2 rounded-full border transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out group-hover:scale-110',
              nodeHighlighted
                ? 'session-tree-active-dot border-accent bg-accent'
                : 'border-border-light bg-diff-bg group-hover:border-text-tertiary',
            )}
            style={{
              left: geometry.nodeCenterXPx - TREE_NODE_DOT_OFFSET_PX,
              width: TREE_NODE_DOT_SIZE_PX,
              height: TREE_NODE_DOT_SIZE_PX,
            }}
          />
        )}
      </div>
      <button
        ref={(element) => {
          if (element) {
            rowRefs.current.set(String(node.id), element)
          } else {
            rowRefs.current.delete(String(node.id))
          }
        }}
        type="button"
        tabIndex={index === clampedFocusIndex ? 0 : -1}
        aria-current={nodeHighlighted ? 'true' : undefined}
        onFocus={() => onFocusIndex(index)}
        onClick={() => onSelectNode(node)}
        className={cn(
          'flex min-h-8 min-w-0 flex-1 items-center rounded-lg border px-2.5 py-1 text-left transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
          rowHighlighted
            ? 'border-accent/25 bg-accent/7 text-text-primary shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
            : activePath
              ? 'border-transparent text-text-primary hover:border-accent/15 hover:bg-accent/5'
              : 'border-transparent text-text-tertiary hover:border-border-light/70 hover:bg-bg-hover/55 hover:text-text-secondary',
          archivedBranch && !nodeHighlighted && 'opacity-70',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <span
            className={cn(
              'mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted',
              nodeHighlighted && 'text-accent/80',
            )}
          >
            {nodeRoleLabel(node)}
          </span>
          <span className="text-[12px]">{nodeLabel(node)}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {row.expandableChildCount > 1 ? (
            <SessionTreeBadge label={`${row.expandableChildCount} paths`} tone="muted" />
          ) : null}
          {isDraftNode ? <SessionTreeBadge label="Draft" tone="warning" /> : null}
          {isActiveBranchHead ? <SessionTreeBadge label="Active" tone="accent" /> : null}
          {archivedBranch ? <SessionTreeBadge label="Archived" tone="muted" /> : null}
          {nodeBranches.map((branch) => (
            <SessionTreeBadge key={String(branch.id)} label={branch.name} tone="muted" />
          ))}
        </span>
      </button>
    </div>
  )
}
