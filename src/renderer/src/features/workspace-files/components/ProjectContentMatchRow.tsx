import type { WorkspaceContentMatch } from '@shared/types/workspace-files'
import { TextSearch } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { languageFromPath } from '@/shared/lib/syntax/language-registry'
import { Button } from '@/shared/ui/Button'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { workspaceLanguageAssociation } from '../lib/workspace-language-associations'

function SearchSyntaxSnippet({
  path,
  lineText,
  matchStart,
  matchLength,
  projectIdentity,
}: {
  readonly path: string
  readonly lineText: string
  readonly matchStart: number
  readonly matchLength: number
  readonly projectIdentity: string
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  // Without an observer to defer it, the line highlights at once.
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  return (
    <span ref={containerRef} className="relative mt-0.5 block min-w-0 overflow-hidden">
      {nearViewport ? (
        <SyntaxBlock
          source={lineText}
          language={
            workspaceLanguageAssociation(window.localStorage, projectIdentity, path) ??
            languageFromPath(path)
          }
          priority="near-viewport"
          ariaLabel={`Matching source from ${path}`}
          className="overflow-hidden rounded-none bg-transparent p-0 text-xs leading-5 text-text-tertiary"
        />
      ) : (
        <span className="block truncate font-mono text-xs leading-5 text-text-tertiary">
          {lineText}
        </span>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 h-5 rounded-sm bg-accent/25 ring-1 ring-accent/35"
        style={{ left: `${String(matchStart)}ch`, width: `${String(Math.max(1, matchLength))}ch` }}
      />
    </span>
  )
}

/** One matching line in project content search, with its highlighted source. */
export function ContentMatchRow({
  match,
  selected,
  rowRef,
  projectPath,
  onHover,
  onChoose,
}: {
  readonly match: WorkspaceContentMatch
  readonly selected: boolean
  readonly rowRef: RefObject<HTMLButtonElement | null> | undefined
  readonly projectPath: string | null
  readonly onHover: () => void
  readonly onChoose: () => void
}) {
  return (
    <Button
      ref={rowRef}
      variant="unstyled"
      onMouseMove={onHover}
      onClick={onChoose}
      className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left ${
        selected ? 'bg-bg-hover' : 'hover:bg-bg-hover/70'
      }`}
    >
      <TextSearch className="mt-0.5 size-4 shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-text-secondary">{match.path}</span>
          <span className="font-mono text-xs text-accent">:{match.lineNumber}</span>
        </span>
        {projectPath ? (
          <SearchSyntaxSnippet
            path={match.path}
            lineText={match.lineText}
            matchStart={match.matchStart}
            matchLength={match.matchLength}
            projectIdentity={projectPath}
          />
        ) : null}
      </span>
    </Button>
  )
}
