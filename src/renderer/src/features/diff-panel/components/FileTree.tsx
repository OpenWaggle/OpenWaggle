import type { GitFileDiff } from '@shared/types/git'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const FILE_TREE_NODE_VALUE_12 = 12
const FILE_TREE_NODE_VALUE_8 = 8
const FILE_TREE_NODE_VALUE_4 = 4

interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  isFile: boolean
  isChanged: boolean
  /** Change status and line counts, for files only (issue #30). */
  stats?: FileChangeStats
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted'

export interface FileChangeStats {
  readonly status: FileChangeStatus
  readonly additions: number
  readonly deletions: number
}

/**
 * Git reports add/delete through the patch's mode header rather than a status
 * field, so derive it from the patch we already have.
 */
export function fileChangeStats(file: GitFileDiff): FileChangeStats {
  const status: FileChangeStatus = file.diff.includes('\nnew file mode ')
    ? 'added'
    : file.diff.includes('\ndeleted file mode ')
      ? 'deleted'
      : 'modified'
  return { status, additions: file.additions, deletions: file.deletions }
}

const STATUS_GLYPH: Record<FileChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'text-diff-add-mark',
  modified: 'text-accent',
  deleted: 'text-diff-remove-text',
}

function FileChangeBadges({ stats }: { readonly stats: FileChangeStats }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">
      {stats.additions > 0 ? (
        <span className="text-[10px] text-diff-add-mark">+{String(stats.additions)}</span>
      ) : null}
      {stats.deletions > 0 ? (
        <span className="text-[10px] text-diff-remove-text">-{String(stats.deletions)}</span>
      ) : null}
      <span
        role="img"
        aria-label={stats.status}
        title={stats.status}
        className={cn('w-2 text-center text-[10px] font-semibold', STATUS_CLASS[stats.status])}
      >
        {STATUS_GLYPH[stats.status]}
      </span>
    </span>
  )
}

function getChildMap(pathKey: string, childMapsByPath: Map<string, Map<string, TreeNode>>) {
  let childMap = childMapsByPath.get(pathKey)
  if (!childMap) {
    childMap = new Map()
    childMapsByPath.set(pathKey, childMap)
  }
  return childMap
}

function buildTree(files: readonly GitFileDiff[]) {
  const changedPaths = new Set(files.map((f) => f.path))
  const statsByPath = new Map(files.map((f) => [f.path, fileChangeStats(f)]))
  const root: TreeNode[] = []
  const rootChildrenByName = new Map<string, TreeNode>()
  const childMapsByPath = new Map<string, Map<string, TreeNode>>()

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    let currentChildrenByName = rootChildrenByName

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? ''
      const isFile = i === parts.length - 1
      const pathSoFar = parts.slice(0, i + 1).join('/')

      let existing = currentChildrenByName.get(part)
      if (!existing) {
        existing = {
          name: part,
          path: pathSoFar,
          children: [],
          isFile,
          isChanged: isFile && changedPaths.has(file.path),
          ...(isFile ? { stats: statsByPath.get(pathSoFar) } : {}),
        }
        current.push(existing)
        currentChildrenByName.set(part, existing)
      }
      current = existing.children
      currentChildrenByName = getChildMap(pathSoFar, childMapsByPath)
    }
  }

  return root
}

interface FileTreeNodeProps {
  node: TreeNode
  depth: number
  onFileClick: (path: string) => void
}

function FileTreeNode({ node, depth, onFileClick }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)

  // Indentation: 12px root, increases by 8px per level
  const paddingLeft = FILE_TREE_NODE_VALUE_12 + depth * FILE_TREE_NODE_VALUE_8

  if (node.isFile) {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onFileClick(node.path)}
        className={cn(
          'flex items-center gap-1.5 h-5 w-full text-left',
          node.isChanged && 'bg-diff-highlight-bg',
        )}
        style={{ paddingLeft: `${String(paddingLeft + FILE_TREE_NODE_VALUE_4)}px` }}
      >
        <span
          className={cn(
            'truncate text-[12px]',
            node.isChanged ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {node.name}
        </span>
        {node.stats ? <FileChangeBadges stats={node.stats} /> : null}
      </Button>
    )
  }

  const ChevIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="w-full">
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 h-[22px] w-full text-left"
        style={{ paddingLeft: `${String(paddingLeft)}px` }}
      >
        <ChevIcon className="size-[11px] text-text-tertiary shrink-0" />
        <span className="text-[12px] text-text-secondary">{node.name}</span>
      </Button>
      {expanded &&
        node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
        ))}
    </div>
  )
}

interface FileTreeProps {
  readonly files: readonly GitFileDiff[]
  readonly onFileClick: (path: string) => void
}

export function FileTree({ files, onFileClick }: FileTreeProps) {
  const tree = buildTree(files)

  return (
    <div className="flex flex-col justify-between h-full w-[200px] bg-diff-bg border-l border-border py-3 shrink-0">
      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {tree.map((node) => (
          <FileTreeNode key={node.path} node={node} depth={0} onFileClick={onFileClick} />
        ))}
      </div>
    </div>
  )
}
