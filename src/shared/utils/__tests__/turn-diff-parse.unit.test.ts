import { describe, expect, it } from 'vitest'
import { parseTurnDiffFilesFromUnifiedDiff, sumDeletions, sumInsertions } from '../turn-diff-parse'

const SAMPLE_DIFF = `diff --git a/src/b.ts b/src/b.ts
index 111..222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 context
+added line
-removed line
diff --git a/src/a.ts b/src/a.ts
new file mode 100644
--- /dev/null
+++ b/src/a.ts
@@ -0,0 +1,2 @@
+first
+second
`

describe('parseTurnDiffFilesFromUnifiedDiff', () => {
  it('returns per-file additions/deletions sorted by path', () => {
    const files = parseTurnDiffFilesFromUnifiedDiff(SAMPLE_DIFF)
    expect(files).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 0 },
      { path: 'src/b.ts', additions: 1, deletions: 1 },
    ])
  })

  it('totals insertions/deletions across files', () => {
    const files = parseTurnDiffFilesFromUnifiedDiff(SAMPLE_DIFF)
    expect(sumInsertions(files)).toBe(3)
    expect(sumDeletions(files)).toBe(1)
  })

  it('returns an empty list for an empty diff', () => {
    expect(parseTurnDiffFilesFromUnifiedDiff('')).toEqual([])
    expect(parseTurnDiffFilesFromUnifiedDiff('   \n  ')).toEqual([])
  })
})
