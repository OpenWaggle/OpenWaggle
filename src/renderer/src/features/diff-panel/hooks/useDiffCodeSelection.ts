import type { CodeViewLineSelection } from '@pierre/diffs'
import { useCallback, useState } from 'react'
import { codeViewItemId } from '../lib/code-view-items'
import type { ReviewCommentLocation } from '../state/review-store'

function selectedFilePath(paths: Iterable<string>, itemId: string) {
  return [...paths].find((path) => codeViewItemId(path) === itemId)
}

export function useDiffCodeSelection(
  patchByPath: ReadonlyMap<string, string>,
  onSetActiveComment: (location: ReviewCommentLocation | null) => void,
) {
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const handleSelectionChange = useCallback(
    (next: CodeViewLineSelection | null) => {
      setSelection(next)
      if (next === null) {
        onSetActiveComment(null)
        return
      }
      const filePath = selectedFilePath(patchByPath.keys(), next.id)
      if (filePath === undefined) return
      const start = Math.min(next.range.start, next.range.end)
      const end = Math.max(next.range.start, next.range.end)
      onSetActiveComment({
        filePath,
        line: start,
        endLine: end,
        lineType: next.range.side === 'deletions' ? 'remove' : 'add',
      })
    },
    [onSetActiveComment, patchByPath],
  )
  return [selection, handleSelectionChange] as const
}
