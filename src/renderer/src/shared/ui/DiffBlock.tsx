import { PatchDiff, useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react'
import { shouldVirtualizeSyntaxSource } from '@shared/syntax-highlighting-performance'
import type { DiffView } from '@shared/types/settings'
import { useEffect, useMemo } from 'react'
import { cn } from '@/shared/lib/cn'
import { registerPendingPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax-runtime'
import { SourceView } from './SourceView'

const DIFF_BLOCK_AST_CACHE_ENTRIES = 16

function createPierreWorker() {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
}

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
}: {
  readonly patch: string
  readonly className?: string
  readonly view: DiffView
  readonly wrap: boolean
  readonly theme: string
}) {
  const options = useMemo(
    () => ({
      theme,
      diffStyle: view,
      overflow: diffOverflow(wrap),
    }),
    [theme, view, wrap],
  )
  if (shouldVirtualizeSyntaxSource(patch)) {
    return (
      <SourceView
        source={completeUnifiedPatch(patch)}
        language="diff"
        theme={theme}
        showLineNumbers={false}
        ariaLabel="Large diff source"
        className={cn('max-h-128 min-h-48', className)}
      />
    )
  }
  registerPendingPierreSyntaxResources()
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: createPierreWorker,
        poolSize: 1,
        totalASTLRUCacheSize: DIFF_BLOCK_AST_CACHE_ENTRIES,
      }}
      highlighterOptions={{ theme }}
    >
      <DiffBlockWorkerTheme theme={theme} />
      <div className={cn('diff-chrome overflow-auto', className)}>
        <PatchDiff patch={completeUnifiedPatch(patch)} options={options} />
      </div>
    </WorkerPoolContextProvider>
  )
}
