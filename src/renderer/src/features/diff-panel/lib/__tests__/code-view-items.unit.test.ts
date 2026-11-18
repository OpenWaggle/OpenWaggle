import type { GitFileDiff } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import {
  createCodeViewItemDecorator,
  parseCodeViewItems,
  type ReviewAnnotation,
} from '../code-view-items'

const FILE: GitFileDiff = {
  path: 'src/example.ts',
  additions: 1,
  deletions: 1,
  diff: 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-const before = 1\n+const after = 2\n',
}

describe('per-view CodeView item identity', () => {
  it('keeps existing items stable when a later parsed file is appended', () => {
    const decorate = createCodeViewItemDecorator()
    const parsed = parseCodeViewItems([FILE])
    const initial = decorate(parsed, new Map())
    const later = parseCodeViewItems([
      {
        ...FILE,
        path: 'src/later.ts',
        diff: FILE.diff.replaceAll('src/example.ts', 'src/later.ts'),
      },
    ])
    const appended = decorate([...parsed, ...later], new Map())

    expect(appended[0]).toBe(initial[0])
    expect(appended).toHaveLength(2)
  })

  it('updates annotation additions, edits, and removals without reusing stale versions', () => {
    const decorate = createCodeViewItemDecorator()
    const parsed = parseCodeViewItems([FILE])
    const initial = decorate(parsed, new Map())
    const annotation: ReviewAnnotation = {
      side: 'additions',
      lineNumber: 1,
      metadata: { kind: 'draft', filePath: FILE.path },
    }
    const annotations = new Map([[FILE.path, [annotation]]])
    const added = decorate(parsed, annotations)
    expect(added[0]).not.toBe(initial[0])
    expect(added[0]?.annotations).toEqual([annotation])
    expect(added[0]?.version).not.toBe(initial[0]?.version)
    expect(decorate(parsed, annotations)[0]).toBe(added[0])

    const saved: ReviewAnnotation = {
      ...annotation,
      metadata: { kind: 'pending', filePath: FILE.path, commentId: 'comment-1' },
    }
    const edited = decorate(parsed, new Map([[FILE.path, [saved]]]))
    expect(edited[0]).not.toBe(added[0])
    expect(edited[0]?.annotations).toEqual([saved])
    expect(edited[0]?.version).not.toBe(added[0]?.version)

    const removed = decorate(parsed, new Map())
    expect(removed[0]?.annotations).toEqual([])
    expect(removed[0]?.version).toBe(initial[0]?.version)
  })

  it('does not reuse an old patch or another view’s item for the same path', () => {
    const decorate = createCodeViewItemDecorator()
    const parsed = parseCodeViewItems([FILE])
    const initial = decorate(parsed, new Map())
    const revised = parseCodeViewItems([
      { ...FILE, diff: FILE.diff.replace('after = 2', 'after = 3') },
    ])
    const updated = decorate(revised, new Map())

    expect(updated[0]).not.toBe(initial[0])
    expect(updated[0]?.version).not.toBe(initial[0]?.version)
    expect(createCodeViewItemDecorator()(parsed, new Map())[0]).not.toBe(initial[0])
  })
})
