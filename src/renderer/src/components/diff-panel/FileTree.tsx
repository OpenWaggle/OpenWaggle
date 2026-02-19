import type { GitFileDiff } from '@shared/types/git'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  isFile: boolean
  isChanged: boolean
}

function buildTree(files: GitFileDiff[]): TreeNode[] {
  const changedPaths = new Set(files.map((f) => f.path))
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? ''
      const isFile = i === parts.length - 1
      const pathSoFar = parts.slice(0, i + 1).join('/')

      let existing = current.find((n) => n.name === part)
      if (!existing) {
        existing = {
          name: part,
          path: pathSoFar,
          children: [],
          isFile,
          isChanged: isFile && changedPaths.has(file.path),
        }
        current.push(existing)
      }
      current = existing.children
    }
  }

  return root
}

interface FileTreeNodeProps {
  node: TreeNode
  depth: number
  onFileClick: (path: string) => void
}

function FileTreeNode({ node, depth, onFileClick }: FileTreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  // Indentation: 12px root, increases by 8px per level
  const paddingLeft = 12 + depth * 8

  if (node.isFile) {
    return (
      <button
        type="button"
        onClick={() => onFileClick(node.path)}
        className={cn(
          'flex items-center gap-1.5 h-5 w-full text-left',
          node.isChanged && 'bg-diff-highlight-bg',
        )}
        style={{ paddingLeft: `${String(paddingLeft + 4)}px` }}
      >
        {node.isChanged && (
          <span className="shrink-0 h-[5px] w-[5px] rounded-full bg-accent" />
        )}
        <span
          className={cn(
            'text-[11px] truncate',
            node.isChanged ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {node.name}
        </span>
      </button>
    )
  }

  const ChevIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 h-[22px] w-full text-left"
        style={{ paddingLeft: `${String(paddingLeft)}px` }}
      >
        <ChevIcon className="h-[11px] w-[11px] text-text-tertiary shrink-0" />
        <span className="text-[11px] text-text-secondary">{node.name}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onFileClick={onFileClick}
          />
        ))}
    </div>
  )
}

interface FileTreeProps {
  files: GitFileDiff[]
  onFileClick: (path: string) => void
  onSendReview: () => void
  reviewCount: number
}

export function FileTree({
  files,
  onFileClick,
  onSendReview,
  reviewCount,
}: FileTreeProps): React.JSX.Element {
  const tree = buildTree(files)

  return (
    <div className="flex flex-col justify-between h-full w-[200px] bg-diff-bg border-l border-border py-3 shrink-0">
      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {tree.map((node) => (
          <FileTreeNode key={node.path} node={node} depth={0} onFileClick={onFileClick} />
        ))}
      </div>

      {/* Send Review Dock */}
      <div className="px-2 pt-1.5 pb-2 border-t border-border">
        <button
          type="button"
          onClick={onSendReview}
          disabled={reviewCount === 0}
          className={cn(
            'flex items-center justify-center gap-1 w-full h-6 rounded bg-gradient-to-b from-accent to-accent-dim border border-accent-dim',
            'text-[10px] font-semibold text-diff-bg',
            'disabled:opacity-40 transition-opacity',
          )}
        >
          <Check className="h-[10px] w-[10px]" />
          Send review
          {reviewCount > 0 && ` (${String(reviewCount)})`}
        </button>
      </div>
    </div>
  )
}
