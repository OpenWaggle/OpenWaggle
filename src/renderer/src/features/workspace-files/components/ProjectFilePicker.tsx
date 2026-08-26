import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { useQuery } from '@tanstack/react-query'
import { File, Search } from 'lucide-react'
import { type KeyboardEvent, useDeferredValue, useEffect, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { workspaceFilesQueryOptions } from '@/queries/workspace-files'
import { Button } from '@/shared/ui/Button'
import { CommandDialog } from '@/shared/ui/CommandDialog'
import { TextInput } from '@/shared/ui/TextInput'
import { useUIStore } from '@/shell/ui-store'
import { useOpenWorkspaceFile } from '../hooks'

export function ProjectFilePicker() {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const close = useUIStore((state) => state.closeCommandSurface)
  const openWorkspaceFile = useOpenWorkspaceFile()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  const filesQuery = useQuery(
    workspaceFilesQueryOptions(projectPath, deferredQuery, WORKSPACE_FILES.PICKER_RESULT_LIMIT),
  )
  const files = filesQuery.data ?? []
  const boundedSelectedIndex = Math.min(selectedIndex, Math.max(0, files.length - 1))

  useEffect(() => {
    if (boundedSelectedIndex < 0) return
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [boundedSelectedIndex])

  function choose(path: string) {
    close()
    openWorkspaceFile(path)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (files.length > 0) {
        setSelectedIndex((current) => Math.min(current + 1, files.length - 1))
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = files[boundedSelectedIndex]
      if (selected) choose(selected.path)
    }
  }

  return (
    <CommandDialog
      title="Go to file"
      description={projectPath ?? 'No active project'}
      onClose={close}
      footer={
        <>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </>
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-text-muted" />
        <TextInput
          autoFocus
          variant="transparent"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search project files…"
          aria-label="Search project files"
          className="h-12 px-0 text-sm"
        />
      </div>
      <div className="max-h-(--workspace-results-height) overflow-y-auto p-1.5 [--workspace-results-height:52vh]">
        {!projectPath ? (
          <EmptyState text="Open a project to search its files." />
        ) : filesQuery.isLoading ? (
          <EmptyState text="Indexing project files…" />
        ) : filesQuery.error ? (
          <EmptyState text={filesQuery.error.message} error />
        ) : files.length === 0 ? (
          <EmptyState text="No matching files." />
        ) : (
          files.map((file, index) => (
            <Button
              key={file.path}
              ref={index === boundedSelectedIndex ? selectedRowRef : undefined}
              variant="unstyled"
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => choose(file.path)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                index === boundedSelectedIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/70'
              }`}
            >
              <File className="size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                {file.basename}
              </span>
              <span className="max-w-3/5 truncate font-mono text-xs text-text-muted">
                {file.path}
              </span>
            </Button>
          ))
        )}
      </div>
    </CommandDialog>
  )
}

function EmptyState({ text, error = false }: { readonly text: string; readonly error?: boolean }) {
  return (
    <output
      className={`flex min-h-36 items-center justify-center px-6 text-center text-xs ${
        error ? 'text-error' : 'text-text-tertiary'
      }`}
    >
      {text}
    </output>
  )
}
