import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useActiveWorkingPath } from '@/features/git/hooks'
import { workspaceContentQueryOptions } from '@/queries/workspace-files'
import { projectName } from '@/shared/lib/format'
import { api } from '@/shared/lib/ipc'
import { CommandDialog } from '@/shared/ui/CommandDialog'
import { TextInput } from '@/shared/ui/TextInput'
import { useUIStore } from '@/shell/ui-store'
import { useOpenWorkspaceFile } from '../hooks'
import { ContentMatchRow } from './ProjectContentMatchRow'

const CONTENT_SEARCH_DEBOUNCE_MS = 200
const CONTENT_SEARCH_FOOTER = (
  <>
    <span>↑↓ navigate</span>
    <span>↵ open line</span>
    <span>esc close</span>
  </>
)

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
    void api.cancelWorkspaceContentSearch(projectPath).catch(() => undefined)
  }, [projectPath, query])

  useEffect(() => {
    if (!projectPath) return
    return () => {
      void api.cancelWorkspaceContentSearch(projectPath).catch(() => undefined)
    }
  }, [projectPath])
}

function chooseContentMatch(
  close: () => void,
  openWorkspaceFile: (path: string, line: number) => void,
  path: string,
  line: number,
) {
  close()
  openWorkspaceFile(path, line)
}

/** The notice the results area shows instead of matches, or null when there are matches. */
function contentSearchNotice(input: {
  readonly projectPath: string | null
  readonly query: string
  readonly searching: boolean
  readonly error: Error | null
  readonly matchCount: number
}) {
  if (!input.projectPath) {
    return { text: 'Open a project to search its contents.' } satisfies {
      readonly text: string
      readonly error?: boolean
    }
  }
  if (input.query.trim().length === 0) {
    return { text: 'Type to search text across indexed project files.' } satisfies {
      readonly text: string
      readonly error?: boolean
    }
  }
  if (input.searching) {
    return { text: 'Searching project contents…' } satisfies {
      readonly text: string
      readonly error?: boolean
    }
  }
  if (input.error) {
    return { text: input.error.message, error: true } satisfies {
      readonly text: string
      readonly error?: boolean
    }
  }
  if (input.matchCount === 0) {
    return { text: 'No matching lines.' } satisfies {
      readonly text: string
      readonly error?: boolean
    }
  }
  return null
}

function handleContentSearchKey(
  event: KeyboardEvent<HTMLInputElement>,
  input: {
    readonly close: () => void
    readonly matchCount: number
    readonly moveSelection: (update: (current: number) => number) => void
    readonly chooseSelected: () => void
  },
) {
  if (event.key === 'Escape') {
    event.preventDefault()
    input.close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (input.matchCount > 0) {
      input.moveSelection((current) => Math.min(current + 1, input.matchCount - 1))
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    input.moveSelection((current) => Math.max(0, current - 1))
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    input.chooseSelected()
  }
}

export function ProjectContentSearch() {
  const projectPath = useActiveWorkingPath()
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

  const notice = contentSearchNotice({
    projectPath,
    query,
    searching: !queryIsSettled || matchesQuery.isLoading,
    error: matchesQuery.error,
    matchCount: matches.length,
  })

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    handleContentSearchKey(event, {
      close,
      matchCount: matches.length,
      moveSelection: setSelectedIndex,
      chooseSelected: () => {
        const selected = matches[boundedSelectedIndex]
        if (selected) {
          chooseContentMatch(close, openWorkspaceFile, selected.path, selected.lineNumber)
        }
      },
    })
  }

  return (
    <CommandDialog
      title="Search project contents"
      description={projectPath ? projectName(projectPath) : 'No active project'}
      onClose={close}
      footer={CONTENT_SEARCH_FOOTER}
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
        {notice ? (
          <ContentEmptyState
            text={notice.text}
            {...(notice.error === undefined ? {} : { error: notice.error })}
          />
        ) : (
          matches.map((match, index) => (
            <ContentMatchRow
              key={`${match.path}:${String(match.lineNumber)}`}
              match={match}
              selected={index === boundedSelectedIndex}
              rowRef={index === boundedSelectedIndex ? selectedRowRef : undefined}
              projectPath={projectPath}
              onHover={() => setSelectedIndex(index)}
              onChoose={() =>
                chooseContentMatch(close, openWorkspaceFile, match.path, match.lineNumber)
              }
            />
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
