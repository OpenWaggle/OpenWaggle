import { PatchDiff } from '@pierre/diffs/react'
import { shouldVirtualizeSyntaxSource } from '@shared/syntax-highlighting-performance'
import type { DiffView } from '@shared/types/settings'
import { useMemo } from 'react'
import { cn } from '@/shared/lib/cn'
import { registerPendingPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax-runtime'
import { SourceView } from './SourceView'

function diffOverflow(wrap: boolean): 'wrap' | 'scroll' {
  return wrap ? 'wrap' : 'scroll'
}

function completeUnifiedPatch(patch: string) {
  if (/^---\s/mu.test(patch) && /^\+\+\+\s/mu.test(patch)) return patch
  return `--- a/file\n+++ b/file\n${patch}`
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
    <div className={cn('diff-chrome overflow-auto', className)}>
      <PatchDiff patch={completeUnifiedPatch(patch)} options={options} />
    </div>
  )
}
