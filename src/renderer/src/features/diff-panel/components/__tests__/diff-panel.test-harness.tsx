import type { GitFileDiff, GitStatusSummary } from '@shared/types/git'
import { type ReactNode, type Ref, useImperativeHandle, useState } from 'react'
import { Button } from '@/shared/ui/Button'

/**
 * Shared harness for diff-panel component tests.
 *
 * CodeView is a measurement-driven renderer (Shiki, virtualization,
 * ResizeObserver) and does not render meaningfully under jsdom, so it is stubbed
 * to exercise OUR wiring -- items, annotations, and selection plumbing. The real
 * renderer is verified in the Electron app.
 */
export interface StubAnnotation {
  readonly side: string
  readonly lineNumber: number
  readonly metadata?: { readonly kind: string; readonly commentId?: string }
}

export function StubWorkerPoolContextProvider({ children }: { readonly children: ReactNode }) {
  return children
}

interface StubCodeViewProps {
  ref?: Ref<StubCodeViewHandle>
  items: readonly {
    id: string
    fileDiff: { name: string }
    annotations?: readonly StubAnnotation[]
  }[]
  renderAnnotation?: (annotation: StubAnnotation, item: unknown) => ReactNode
  onSelectedLinesChange?: (selection: {
    id: string
    range: { start: number; end: number; side: string }
  }) => void
}

const STUB_SELECTED_LINE = 8

interface StubCodeViewHandle {
  scrollTo: (target: { readonly id: string }) => void
}

export function StubCodeView({
  ref,
  items,
  renderAnnotation,
  onSelectedLinesChange,
}: StubCodeViewProps) {
  const [scrolledItemId, setScrolledItemId] = useState<string | null>(null)
  useImperativeHandle(ref, () => ({ scrollTo: (target) => setScrolledItemId(target.id) }), [])
  return (
    <div data-scrolled-item-id={scrolledItemId ?? undefined} data-testid="code-view">
      <code data-testid="code-view-ready" />
      {items.map((item) => (
        <div key={item.id}>
          <Button
            variant="unstyled"
            type="button"
            onClick={() =>
              onSelectedLinesChange?.({
                id: item.id,
                range: {
                  start: STUB_SELECTED_LINE,
                  end: STUB_SELECTED_LINE,
                  side: 'additions',
                },
              })
            }
          >
            select {item.fileDiff.name}
          </Button>
          {(item.annotations ?? []).map((annotation) => (
            <div
              key={`${annotation.side}:${String(annotation.lineNumber)}:${annotation.metadata?.kind ?? ''}`}
            >
              {renderAnnotation?.(annotation, item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,8 +1,8 @@
 const one = 1
 const two = 2
 const three = 3
 const four = 4
-const old line = 5
+new line
 const six = 6
 const seven = 7
 const eight = 8`

export function fileDiff(path = 'src/app.ts') {
  return { path, diff: SAMPLE_DIFF, additions: 1, deletions: 1 } satisfies GitFileDiff
}

export function gitStatus(changedFiles: GitStatusSummary['changedFiles']): GitStatusSummary {
  return {
    branch: 'main',
    additions: 1,
    deletions: 1,
    filesChanged: changedFiles.length,
    changedFiles,
    clean: changedFiles.length === 0,
    ahead: 0,
    behind: 0,
  }
}
