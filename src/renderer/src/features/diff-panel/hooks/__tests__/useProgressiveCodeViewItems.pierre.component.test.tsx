import { CodeView as PierreCodeView } from '@pierre/diffs'
import { CodeView } from '@pierre/diffs/react'
import type { GitFileDiff } from '@shared/types/git'
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewAnnotation } from '../../lib/code-view-items'
import { useProgressiveCodeViewItems } from '../useProgressiveCodeViewItems'

const NO_ANNOTATIONS: ReadonlyMap<string, readonly ReviewAnnotation[]> = new Map()
const OPTIONS = { theme: 'github-dark', diffStyle: 'unified' } as const

function changedFile(index: number): GitFileDiff {
  const path = `src/file-${String(index)}.ts`
  return {
    path,
    additions: 1,
    deletions: 1,
    diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-const previous = 1\n+const current = 2\n`,
  }
}

function ProgressivePierreView({ files }: { readonly files: readonly GitFileDiff[] }) {
  const { items } = useProgressiveCodeViewItems(files, NO_ANNOTATIONS)
  return items ? <CodeView items={items} options={OPTIONS} disableWorkerPool /> : null
}

describe('progressive items at the real Pierre React boundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('appends later batches without asking Pierre to synchronously rerender the visible files', async () => {
    // jsdom has no layout engine. Keep the real React adapter and item reconciliation, but stop
    // only the final DOM-rendering step whose long-task budget is exercised in Electron E2E.
    const renderView = vi.spyOn(PierreCodeView.prototype, 'render').mockImplementation(() => {})
    const setItems = vi.spyOn(PierreCodeView.prototype, 'setItems')
    const addItems = vi.spyOn(PierreCodeView.prototype, 'addItems')
    render(
      <ProgressivePierreView files={Array.from({ length: 9 }, (_, index) => changedFile(index))} />,
    )

    await waitFor(() => expect(addItems).toHaveBeenCalledTimes(2))
    expect(setItems).toHaveBeenCalledTimes(1)
    expect(addItems.mock.calls.map(([items]) => items.length)).toEqual([4, 4])
    // Setup and the first controlled item list can request immediate rendering; append batches
    // must use Pierre's deferred/skip-render append path instead of render(true) in a layout effect.
    expect(renderView.mock.calls.filter(([immediate]) => immediate === true)).toHaveLength(2)
  })
})
