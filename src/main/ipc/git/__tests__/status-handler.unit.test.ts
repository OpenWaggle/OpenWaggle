import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../status-parse'

const diff = (...lines: string[]) => lines.join('\n')
const stats = (input: string) =>
  parseUnifiedDiff(input).map(({ path, additions, deletions }) => [path, additions, deletions])

describe('parseUnifiedDiff', () => {
  it.each(['', '   \n  '])('finds no file in %j', (input) => {
    expect(parseUnifiedDiff(input)).toEqual([])
  })

  it('keeps each file diff whole and counts changed lines, not the --- and +++ headers', () => {
    const input = diff(
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc..def 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged line',
      '-removed line',
      '+added line 1',
      '+added line 2',
    )

    expect(parseUnifiedDiff(input)).toEqual([
      { path: 'src/index.ts', diff: input, additions: 2, deletions: 1 },
    ])
  })

  it.each([
    [
      'several files',
      diff(
        'diff --git a/file1.ts b/file1.ts',
        '--- a/file1.ts',
        '+++ b/file1.ts',
        '@@ -1 +1 @@',
        '-old1',
        '+new1',
        'diff --git a/file2.ts b/file2.ts',
        '--- a/file2.ts',
        '+++ b/file2.ts',
        '@@ -1 +1,2 @@',
        '-old2',
        '+new2a',
        '+new2b',
      ),
      [
        ['file1.ts', 1, 1],
        ['file2.ts', 2, 1],
      ],
    ],
    [
      'a new file',
      diff(
        'diff --git a/new-file.ts b/new-file.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new-file.ts',
        '@@ -0,0 +1,3 @@',
        '+line 1',
        '+line 2',
        '+line 3',
      ),
      [['new-file.ts', 3, 0]],
    ],
    [
      'a deleted file',
      diff(
        'diff --git a/removed.ts b/removed.ts',
        'deleted file mode 100644',
        '--- a/removed.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-line 1',
        '-line 2',
      ),
      [['removed.ts', 0, 2]],
    ],
    [
      'a rename, under its b/ path',
      diff(
        'diff --git a/old-name.ts b/new-name.ts',
        '--- a/old-name.ts',
        '+++ b/new-name.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ),
      [['new-name.ts', 1, 1]],
    ],
    [
      'a path with spaces',
      diff(
        'diff --git a/my file.ts b/my file.ts',
        '--- a/my file.ts',
        '+++ b/my file.ts',
        '@@ -1 +1 @@',
        '+added',
      ),
      [['my file.ts', 1, 0]],
    ],
    [
      'a mode-only change',
      diff('diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'),
      [['script.sh', 0, 0]],
    ],
    [
      'several hunks in one file',
      diff(
        'diff --git a/f.ts b/f.ts',
        '--- a/f.ts',
        '+++ b/f.ts',
        '@@ -1,3 +1,3 @@',
        '-old line 1',
        '+new line 1',
        ' context',
        '@@ -10,2 +10,3 @@',
        ' context2',
        '-old line 10',
        '+new line 10a',
        '+new line 10b',
      ),
      [['f.ts', 3, 2]],
    ],
  ])('counts %s', (_label, input, expected) => {
    expect(stats(input)).toEqual(expected)
  })
})
