import type { GitFileDiff } from '@shared/types/git'

export type FileChangeStatus = 'added' | 'modified' | 'deleted'

export interface FileChangeStats {
  readonly status: FileChangeStatus
  readonly additions: number
  readonly deletions: number
}

/** A node in the Changed-file navigator. Ids are repo-relative paths. */
export interface NavigatorNode {
  readonly path: string
  readonly name: string
  readonly isFile: boolean
  readonly stats?: FileChangeStats
}

export interface NavigatorTree {
  readonly nodes: ReadonlyMap<string, NavigatorNode>
  readonly childrenByPath: ReadonlyMap<string, readonly string[]>
  readonly rootId: string
}

export const NAVIGATOR_ROOT_ID = ''

/**
 * Git reports add/delete through the patch's mode header rather than a status
 * field, so derive the status from the patch we already have.
 */
export function fileChangeStats(file: GitFileDiff): FileChangeStats {
  if (file.diff.includes('\nnew file mode ')) {
    return { status: 'added', additions: file.additions, deletions: file.deletions }
  }
  if (file.diff.includes('\ndeleted file mode ')) {
    return { status: 'deleted', additions: file.additions, deletions: file.deletions }
  }
  return { status: 'modified', additions: file.additions, deletions: file.deletions }
}

/**
 * Build the navigator's directory tree from flat file paths.
 *
 * Kept pure and separate from the component so the grouping is testable without
 * a tree library, and so swapping the rendering layer cannot change the shape.
 */
export function buildNavigatorTree(files: readonly GitFileDiff[]): NavigatorTree {
  const nodes = new Map<string, NavigatorNode>()
  const children = new Map<string, string[]>()

  const addChild = (parent: string, child: string) => {
    const existing = children.get(parent)
    if (existing === undefined) {
      children.set(parent, [child])
      return
    }
    if (!existing.includes(child)) existing.push(child)
  }

  for (const file of files) {
    const parts = file.path.split('/').filter((part) => part !== '')
    let parent = NAVIGATOR_ROOT_ID

    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1
      const path = parts.slice(0, index + 1).join('/')

      if (!nodes.has(path)) {
        nodes.set(path, {
          path,
          name: part,
          isFile,
          ...(isFile ? { stats: fileChangeStats(file) } : {}),
        })
      }
      addChild(parent, path)
      parent = path
    }
  }

  // Directories before files, then alphabetical — stable and predictable.
  for (const list of children.values()) {
    list.sort((a, b) => {
      const aFile = nodes.get(a)?.isFile === true
      const bFile = nodes.get(b)?.isFile === true
      if (aFile !== bFile) return aFile ? 1 : -1
      return a.localeCompare(b)
    })
  }

  return { nodes, childrenByPath: children, rootId: NAVIGATOR_ROOT_ID }
}
