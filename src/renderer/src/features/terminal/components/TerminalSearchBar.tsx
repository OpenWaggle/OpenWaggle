import type { SearchAddon } from '@xterm/addon-search'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'

const MIN_QUERY_LENGTH = 1

interface TerminalSearchBarProps {
  readonly addon: SearchAddon | null
  readonly onDismiss: () => void
}

/** Minimal find widget for the focused terminal pane (VSCode-style strip). */
export function TerminalSearchBar({ addon, onDismiss }: TerminalSearchBarProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = (direction: 'next' | 'previous', term: string) => {
    if (addon === null || term.length < MIN_QUERY_LENGTH) return
    const options = { caseSensitive }
    if (direction === 'next') addon.findNext(term, options)
    else addon.findPrevious(term, options)
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg px-2 py-1">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in terminal"
        onChange={(event) => {
          const nextQuery = event.target.value
          setQuery(nextQuery)
          if (nextQuery.length >= MIN_QUERY_LENGTH) runSearch('next', nextQuery)
          else addon?.clearDecorations()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            runSearch(event.shiftKey ? 'previous' : 'next', query)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            addon?.clearDecorations()
            onDismiss()
          }
        }}
        className="w-56 rounded border border-border bg-bg px-2 py-0.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
        aria-label="Find in terminal"
      />
      <Button
        size="xs"
        variant={caseSensitive ? 'accent' : 'ghost'}
        title="Match case"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={() => {
          const next = !caseSensitive
          setCaseSensitive(next)
          if (addon !== null && query.length >= MIN_QUERY_LENGTH) {
            addon.findNext(query, { caseSensitive: next })
          }
        }}
      >
        Aa
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Previous match"
        aria-label="Previous terminal search match"
        onClick={() => runSearch('previous', query)}
      >
        ↑
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Next match"
        aria-label="Next terminal search match"
        onClick={() => runSearch('next', query)}
      >
        ↓
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Close search"
        aria-label="Close terminal search"
        onClick={() => {
          addon?.clearDecorations()
          onDismiss()
        }}
      >
        ✕
      </Button>
    </div>
  )
}
