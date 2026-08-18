import { describe, expect, it } from 'vitest'
import {
  parseTurnDiffFilesFromUnifiedDiff,
  splitUnifiedDiffIntoFileDiffs,
  sumDeletions,
  sumInsertions,
} from '../turn-diff-parse'

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

  it('parses rename-only diffs with zero line changes', () => {
    const renameDiff = `diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n`
    expect(parseTurnDiffFilesFromUnifiedDiff(renameDiff)).toEqual([
      { path: 'new.ts', additions: 0, deletions: 0 },
    ])
  })

  it('normalizes CRLF input before parsing', () => {
    const crlf = SAMPLE_DIFF.replace(/\n/g, '\r\n')
    expect(parseTurnDiffFilesFromUnifiedDiff(crlf)).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 0 },
      { path: 'src/b.ts', additions: 1, deletions: 1 },
    ])
  })
})

describe('splitUnifiedDiffIntoFileDiffs', () => {
  it('returns empty for an empty diff', () => {
    expect(splitUnifiedDiffIntoFileDiffs('')).toEqual([])
  })

  it('splits into per-file GitFileDiff entries with counts and reconstructed blocks', () => {
    const result = splitUnifiedDiffIntoFileDiffs(SAMPLE_DIFF)
    expect(result.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(result[0]).toMatchObject({ path: 'src/a.ts', additions: 2, deletions: 0 })
    expect(result[0]?.diff.startsWith('diff --git ')).toBe(true)
    expect(result[1]).toMatchObject({ path: 'src/b.ts', additions: 1, deletions: 1 })
  })
})
