import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import type { WorkspaceFileEntry } from '@shared/types/workspace-files'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, File, Folder, Search } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { workspaceFilesQueryOptions } from '@/queries/workspace-files'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'

interface FileTreeNode {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, FileTreeNode>
  readonly files: WorkspaceFileEntry[]
}

export function workspaceExplorerSearch(query: string) {
  const normalized = query.trim()
  return {
    query: normalized,
    limit: normalized
      ? WORKSPACE_FILES.PICKER_RESULT_LIMIT
      : WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1,
  }
}

const TREE_INDENT_PX = 12
const DIRECTORY_OFFSET_PX = 6
const FILE_OFFSET_PX = 22
function createTreeNode(name: string, path: string): FileTreeNode {
  return { name, path, directories: new Map(), files: [] }
}

function buildTree(files: readonly WorkspaceFileEntry[]) {
  const root = createTreeNode('', '')
  for (const file of files) {
    const segments = file.path.split('/')
    let node = root
    for (const segment of segments.slice(0, -1)) {
      const childPath = node.path ? `${node.path}/${segment}` : segment
      const existing = node.directories.get(segment)
      if (existing) {
        node = existing
      } else {
        const child = createTreeNode(segment, childPath)
        node.directories.set(segment, child)
        node = child
      }
    }
    node.files.push(file)
  }
  return root
}

function sortedDirectories(node: FileTreeNode) {
  return [...node.directories.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function sortedFiles(node: FileTreeNode) {
  return [...node.files].sort((left, right) => left.basename.localeCompare(right.basename))
}

function parentDirectories(path: string) {
  const segments = path.split('/').slice(0, -1)
  const parents: string[] = []
  for (let index = 0; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index + 1).join('/'))
  }
  return parents
}

interface TreeRowsProps {
  readonly node: FileTreeNode
  readonly depth: number
  readonly state: {
    readonly currentPath: string
    readonly expanded: ReadonlySet<string>
    readonly dragSource: string | null
  }
  readonly actions: {
    readonly onToggleDirectory: (path: string) => void
    readonly onOpenFile: (path: string) => void
    readonly onDragStart: (event: DragEvent<HTMLElement>, path: string) => void
    readonly onDropIntoDirectory: (event: DragEvent<HTMLElement>, path: string) => void
  }
}

function TreeRows({ node, depth, state, actions }: TreeRowsProps) {
  return (
    <>
      {sortedDirectories(node).map((directory) => {
        const open =
          state.expanded.has(directory.path) || state.currentPath.startsWith(`${directory.path}/`)
        return (
          <div key={directory.path}>
            <Button
              variant="unstyled"
              className="flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
              style={{ paddingLeft: `${String(depth * TREE_INDENT_PX + DIRECTORY_OFFSET_PX)}px` }}
              onClick={() => actions.onToggleDirectory(directory.path)}
              draggable
              onDragStart={(event) => actions.onDragStart(event, directory.path)}
              onDragOver={(event) => {
                if (state.dragSource) event.preventDefault()
              }}
              onDrop={(event) => actions.onDropIntoDirectory(event, directory.path)}
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <Folder className="size-3.5 text-accent/70" />
              <span className="truncate">{directory.name}</span>
            </Button>
            {open && (
              <TreeRows node={directory} depth={depth + 1} state={state} actions={actions} />
            )}
          </div>
        )
      })}
      {sortedFiles(node).map((file) => (
        <Button
          key={file.path}
          variant="unstyled"
          className={`flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-xs ${
            file.path === state.currentPath
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          style={{ paddingLeft: `${String(depth * TREE_INDENT_PX + FILE_OFFSET_PX)}px` }}
          onClick={() => actions.onOpenFile(file.path)}
          draggable
          onDragStart={(event) => actions.onDragStart(event, file.path)}
          title={file.path}
        >
          <File className="size-3.5 shrink-0" />
          <span className="truncate">{file.basename}</span>
        </Button>
      ))}
    </>
  )
}

export function WorkspaceFileBrowser({
  projectPath,
  currentPath,
  onOpenFile,
  onMoveEntry,
}: {
  readonly projectPath: string
  readonly currentPath: string
  readonly onOpenFile: (path: string) => void
  readonly onMoveEntry: (sourcePath: string, targetPath: string) => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(parentDirectories(currentPath)),
  )
  const [dragSource, setDragSource] = useState<string | null>(null)
  const search = workspaceExplorerSearch(query)
  const filesQuery = useQuery(workspaceFilesQueryOptions(projectPath, search.query, search.limit))
  const files = filesQuery.data ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const truncated = !normalizedQuery && files.length > WORKSPACE_FILES.EXPLORER_RESULT_LIMIT
  const visibleFiles = truncated ? files.slice(0, WORKSPACE_FILES.EXPLORER_RESULT_LIMIT) : files
  const tree = buildTree(visibleFiles)

  function toggleDirectory(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function startDrag(event: DragEvent<HTMLElement>, path: string) {
    event.dataTransfer.effectAllowed = 'move'
    setDragSource(path)
  }

  function dropIntoDirectory(event: DragEvent<HTMLElement>, directory: string) {
    event.preventDefault()
    event.stopPropagation()
    if (!dragSource) return
    const basename = dragSource.slice(dragSource.lastIndexOf('/') + 1)
    const targetPath = directory ? `${directory}/${basename}` : basename
    setDragSource(null)
    if (targetPath !== dragSource) onMoveEntry(dragSource, targetPath)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center gap-1.5 border-b border-border px-2">
        <Search className="size-3.5 text-text-muted" />
        <TextInput
          variant="transparent"
          inputSize="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files"
          aria-label="Filter file explorer"
          className="h-8 px-0 text-xs"
        />
      </div>
      <nav
        aria-label="Workspace files"
        className="min-h-0 flex-1 overflow-auto p-1"
        onDragOver={(event) => {
          if (dragSource) event.preventDefault()
        }}
        onDrop={(event) => dropIntoDirectory(event, '')}
        onDragEnd={() => setDragSource(null)}
      >
        {filesQuery.isLoading ? (
          <p className="p-3 text-xs text-text-muted">Loading files…</p>
        ) : filesQuery.error ? (
          <p className="p-3 text-xs text-error">{filesQuery.error.message}</p>
        ) : normalizedQuery ? (
          visibleFiles.map((file) => (
            <Button
              key={file.path}
              variant="unstyled"
              onClick={() => onOpenFile(file.path)}
              draggable
              onDragStart={(event) => startDrag(event, file.path)}
              className={`flex h-7 w-full items-center gap-1.5 rounded px-2 text-left text-xs ${
                file.path === currentPath
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-tertiary hover:bg-bg-hover'
              }`}
              title={file.path}
            >
              <File className="size-3.5 shrink-0" />
              <span className="truncate">{file.path}</span>
            </Button>
          ))
        ) : (
          <TreeRows
            node={tree}
            depth={0}
            state={{ currentPath, expanded, dragSource }}
            actions={{
              onToggleDirectory: toggleDirectory,
              onOpenFile,
              onDragStart: startDrag,
              onDropIntoDirectory: dropIntoDirectory,
            }}
          />
        )}
      </nav>
      {truncated && (
        <p className="border-t border-border px-2 py-1.5 text-xs text-text-muted">
          Showing the first {WORKSPACE_FILES.EXPLORER_RESULT_LIMIT.toLocaleString()} files. Filter
          to find files outside this list.
        </p>
      )}
    </div>
  )
}
