import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { useQuery } from '@tanstack/react-query'
import { Search, TextSearch } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { workspaceContentQueryOptions } from '@/queries/workspace-files'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { CommandDialog } from '@/shared/ui/CommandDialog'
import { TextInput } from '@/shared/ui/TextInput'
import { useUIStore } from '@/shell/ui-store'
import { useOpenWorkspaceFile } from '../hooks'

const CONTENT_SEARCH_DEBOUNCE_MS = 200

function useDebouncedContentQuery(query: string) {
  const [settledQuery, setSettledQuery] = useState(query)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query), CONTENT_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])
  return settledQuery
}

function useCancelProjectContentSearch(projectPath: string | null, query: string) {
  useEffect(() => {
    if (!projectPath || query.trim().length > 0) return
    void api.cancelWorkspaceContentSearch(projectPath)
  }, [projectPath, query])

  useEffect(() => {
    if (!projectPath) return
    return () => {
      void api.cancelWorkspaceContentSearch(projectPath)
    }
  }, [projectPath])
}

export function ProjectContentSearch() {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const close = useUIStore((state) => state.closeCommandSurface)
  const openWorkspaceFile = useOpenWorkspaceFile()
  const [query, setQuery] = useState('')
  const settledQuery = useDebouncedContentQuery(query)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  const queryIsSettled = query === settledQuery
  const matchesQuery = useQuery(
    workspaceContentQueryOptions(projectPath, settledQuery, WORKSPACE_FILES.CONTENT_RESULT_LIMIT),
  )
  const matches = queryIsSettled ? (matchesQuery.data ?? []) : []
  const boundedSelectedIndex = Math.min(selectedIndex, Math.max(0, matches.length - 1))
  useCancelProjectContentSearch(projectPath, query)

  useEffect(() => {
    if (boundedSelectedIndex < 0) return
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [boundedSelectedIndex])

  function choose(path: string, line: number) {
    close()
    openWorkspaceFile(path, line)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (matches.length > 0) {
        setSelectedIndex((current) => Math.min(current + 1, matches.length - 1))
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
      const selected = matches[boundedSelectedIndex]
      if (selected) choose(selected.path, selected.lineNumber)
    }
  }

  return (
    <CommandDialog
      title="Search project contents"
      description={projectPath ?? 'No active project'}
      onClose={close}
      footer={
        <>
          <span>↑↓ navigate</span>
          <span>↵ open line</span>
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
          placeholder="Search text across the project…"
          aria-label="Search project contents"
          className="h-12 px-0 text-sm"
        />
      </div>
      <div className="max-h-(--workspace-results-height) overflow-y-auto p-1.5 [--workspace-results-height:52vh]">
        {!projectPath ? (
          <ContentEmptyState text="Open a project to search its contents." />
        ) : query.trim().length === 0 ? (
          <ContentEmptyState text="Type to search text across indexed project files." />
        ) : !queryIsSettled || matchesQuery.isLoading ? (
          <ContentEmptyState text="Searching project contents…" />
        ) : matchesQuery.error ? (
          <ContentEmptyState text={matchesQuery.error.message} error />
        ) : matches.length === 0 ? (
          <ContentEmptyState text="No matching lines." />
        ) : (
          matches.map((match, index) => (
            <Button
              key={`${match.path}:${String(match.lineNumber)}`}
              ref={index === boundedSelectedIndex ? selectedRowRef : undefined}
              variant="unstyled"
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => choose(match.path, match.lineNumber)}
              className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left ${
                index === boundedSelectedIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/70'
              }`}
            >
              <TextSearch className="mt-0.5 size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-text-secondary">
                    {match.path}
                  </span>
                  <span className="font-mono text-xs text-accent">:{match.lineNumber}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-text-tertiary">
                  {match.lineText}
                </span>
              </span>
            </Button>
          ))
        )}
      </div>
    </CommandDialog>
  )
}

function ContentEmptyState({
  text,
  error = false,
}: {
  readonly text: string
  readonly error?: boolean
}) {
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
