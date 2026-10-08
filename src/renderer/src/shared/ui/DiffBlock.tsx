import { PatchDiff, useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { shouldVirtualizeSyntaxSource } from '@shared/syntax-highlighting-performance'
import type { DiffView } from '@shared/types/settings'
import { useEffect, useMemo } from 'react'
import { cn } from '@/shared/lib/cn'
import { registerPendingPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax-runtime'
import { PIERRE_WORKER_POOL_OPTIONS } from '@/shared/lib/syntax/pierre-worker-pool'
import { SourceView } from './SourceView'

/**
 * An embedded diff caps Pierre's own code scroller rather than an outer box: Pierre
 * scrolls long lines horizontally on that element, so an outer vertical cap would hide
 * its horizontal scrollbar below the fold. Pierre's base layer hides that element's
 * vertical scrollbar (the diff panel never scrolls it vertically), so the cap also
 * shows one; Pierre's `unsafe` layer wins over its base. 15rem matches the edit card's
 * `max-h-60` and the virtualized fallback's `h-60`.
 */
const EMBEDDED_DIFF_CSS = `
[data-code] { max-height: 15rem; overflow-y: auto; }
[data-code]::-webkit-scrollbar { width: 6px; }
[data-code]::-webkit-scrollbar-thumb { background-color: var(--diffs-bg-context); }
`

function diffOverflow(wrap: boolean): 'wrap' | 'scroll' {
  return wrap ? 'wrap' : 'scroll'
}

function completeUnifiedPatch(patch: string) {
  if (/^---\s/mu.test(patch) && /^\+\+\+\s/mu.test(patch)) return patch
  return `--- a/file\n+++ b/file\n${patch}`
}

function DiffBlockWorkerTheme({ theme }: { readonly theme: string }) {
  const workerPool = useWorkerPool()
  useEffect(() => {
    void workerPool?.setRenderOptions({ theme })
  }, [theme, workerPool])
  return null
}

export function DiffBlock({
  patch,
  className,
  view,
  wrap,
  theme,
  embedded = false,
}: {
  readonly patch: string
  readonly className?: string
  readonly view: DiffView
  readonly wrap: boolean
  readonly theme: string
  /**
   * Inside a card that already names the file: no Pierre file header, quiet hunk
   * separators, and a 15rem cap that scrolls both ways on Pierre's code element.
   */
  readonly embedded?: boolean
}) {
  const options = useMemo(
    () => ({
      theme,
      diffStyle: view,
      overflow: diffOverflow(wrap),
      ...(embedded
        ? {
            disableFileHeader: true,
            hunkSeparators: 'simple' as const,
            unsafeCSS: EMBEDDED_DIFF_CSS,
          }
        : {}),
    }),
    [theme, view, wrap, embedded],
  )
  if (shouldVirtualizeSyntaxSource(patch)) {
    // The virtualized view scrolls inside a fixed height; an embedded card is compact.
    return (
      <SourceView
        source={completeUnifiedPatch(patch)}
        language="diff"
        theme={theme}
        showLineNumbers={false}
        ariaLabel="Large diff source"
        className={cn(embedded ? 'h-60' : 'max-h-128 min-h-48', className)}
      />
    )
  }
  registerPendingPierreSyntaxResources()
  return (
    <WorkerPoolContextProvider
      poolOptions={PIERRE_WORKER_POOL_OPTIONS}
      highlighterOptions={{ theme }}
    >
      <DiffBlockWorkerTheme theme={theme} />
      <div className={cn('diff-chrome overflow-auto', className)}>
        <PatchDiff patch={completeUnifiedPatch(patch)} options={options} />
      </div>
    </WorkerPoolContextProvider>
  )
}
