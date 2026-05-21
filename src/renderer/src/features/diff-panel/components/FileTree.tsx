import type { GitFileDiff } from '@shared/types/git'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
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
        {node.isChanged && <span className="shrink-0 size-[5px] rounded-full bg-accent" />}
        <span
          className={cn(
            'text-[12px] truncate',
            node.isChanged ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {node.name}
        </span>
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
  files: readonly GitFileDiff[]
  onFileClick: (path: string) => void
  onSendReview: () => void
  reviewCount: number
}

export function FileTree({ files, onFileClick, onSendReview, reviewCount }: FileTreeProps) {
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
        <Button
          variant="unstyled"
          type="button"
          onClick={onSendReview}
          disabled={reviewCount === 0}
          className={cn(
            'flex items-center justify-center gap-1 w-full h-6 rounded bg-gradient-to-b from-accent to-accent-dim border border-accent-dim',
            'text-[11px] font-semibold text-diff-bg',
            'disabled:opacity-40 transition-opacity',
          )}
        >
          <Check className="size-[10px]" />
          Send review
          {reviewCount > 0 && ` (${String(reviewCount)})`}
        </Button>
      </div>
    </div>
  )
}
