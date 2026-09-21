import type { TurnDiffFileSummary } from '@shared/types/turn-diff'
import { ChevronRight, File, Folder, FolderClosed } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { buildTurnDiffTree, type TurnDiffTreeNode } from '../lib/changed-files-presentation'
import { DiffStatLabel } from './DiffStatLabel'

/** Tree row indent per depth level, mirroring the T3 Code reference. */
const TREE_DEPTH_INDENT_PX = 14
const TREE_BASE_INDENT_PX = 8
// ponytail: directories default expanded with local per-directory overrides; a global
// expand-all toggle can come back if users end up with wide trees.
const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {}

function TreeStat({ stat }: { readonly stat: { additions: number; deletions: number } | null }) {
  if (!stat || (stat.additions === 0 && stat.deletions === 0)) return null
  return (
    <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
      <DiffStatLabel additions={stat.additions} deletions={stat.deletions} />
    </span>
  )
}

function TreeRow({
  depth,
  onRowClick,
  children,
  title,
}: {
  readonly depth: number
  readonly onRowClick: () => void
  readonly children: React.ReactNode
  readonly title?: string
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onRowClick}
      {...(title ? { title } : {})}
      className="group flex w-full items-center gap-1.5 rounded-lg py-1 pr-3 text-left transition-colors hover:bg-bg-hover"
      // Per-depth indentation is layout math, not a fixed class.
      style={{ paddingLeft: `${TREE_BASE_INDENT_PX + depth * TREE_DEPTH_INDENT_PX}px` }}
    >
      {children}
    </Button>
  )
}

/**
 * Directory-grouped file tree for the expanded changed-files card (T3 Code reference).
 * Directories render before files, single-directory chains collapse into one row,
 * and per-directory expansion state is local to the tree.
 */
export function ChangedFilesTree({
  files,
  anchorMessageId,
  onOpenTurnDiff,
}: {
  readonly files: readonly TurnDiffFileSummary[]
  readonly anchorMessageId: string
  readonly onOpenTurnDiff: (messageId: string, filePath?: string) => void
}) {
  const treeNodes = buildTurnDiffTree(files)
  const hasDirectoryNodes = treeNodes.some((node) => node.kind === 'directory')
  const [directoryOverrides, setDirectoryOverrides] = useState(EMPTY_DIRECTORY_OVERRIDES)
  const toggleDirectory = (path: string) =>
    setDirectoryOverrides((current) => ({ ...current, [path]: !(current[path] ?? true) }))

  const renderNode = (node: TurnDiffTreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'directory') {
      const isExpanded = directoryOverrides[node.path] ?? true
      return (
        <div key={`dir:${node.path}`}>
          <TreeRow depth={depth} onRowClick={() => toggleDirectory(node.path)}>
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-text-tertiary transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
            {isExpanded ? (
              <Folder className="size-3.5 shrink-0 text-text-tertiary" />
            ) : (
              <FolderClosed className="size-3.5 shrink-0 text-text-tertiary" />
            )}
            <span className="truncate font-mono text-xs text-text-tertiary">{node.name}</span>
            <TreeStat stat={node.stat} />
          </TreeRow>
          {isExpanded ? (
            <div className="flex flex-col gap-0.5">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <TreeRow
        key={`file:${node.path}`}
        depth={depth}
        title={node.path}
        onRowClick={() => onOpenTurnDiff(anchorMessageId, node.path)}
      >
        {hasDirectoryNodes || depth > 0 ? (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        <File className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="truncate font-mono text-xs text-text-secondary">{node.name}</span>
        <TreeStat stat={node.stat} />
      </TreeRow>
    )
  }

  return <div className="flex flex-col gap-0.5">{treeNodes.map((node) => renderNode(node, 0))}</div>
}
